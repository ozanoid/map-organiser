"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, GripVertical, LayoutGrid, Map as MapIcon, MoreHorizontal, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlaces } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useList } from "@/lib/hooks/use-lists";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import { MapView } from "@/components/map/map-view";
import { PlaceCard } from "@/components/places/place-card";
import { ListMenu, LISTS_HOME } from "@/components/lists/list-menu";
import { ListNoteDialog } from "@/components/lists/list-note-dialog";
import { useListEditor } from "@/components/lists/use-list-editor";
import { UNDO_TOAST_MS } from "@/components/plans/use-plan-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Place } from "@/lib/types";

/**
 * One list: its places in order, each with its note on this list. Drag to
 * reorder; each place's menu edits the note or takes it off the list (with
 * Undo); the list menu shares, renames, describes or deletes it.
 *
 * The list itself — its places in order, their notes — comes from
 * /api/lists/[id] and is the only source of the order: a change shows at
 * once in that cached list (useChangeList) and a drag's position is the
 * place's index there, i.e. on the server. The places' rows, for the cards
 * and the map, come from /api/places?list_id=…; a place whose row hasn't
 * arrived yet (one just added) shows when it does. Every change is one PATCH
 * to the list.
 */

const NO_PLACES: Place[] = [];

function SortablePlaceItem({
  place,
  index,
  note,
  onEditNote,
  onRemove,
}: {
  place: Place;
  index: number;
  note: string | null;
  onEditNote: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: place.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      {/* Drag handle */}
      <button
        type="button"
        className="flex items-center px-2 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        aria-label={`Reorder ${place.name}`}
        {...attributes}
        {...listeners}
      >
        <span className="text-xs font-medium text-muted-foreground w-5 text-center mr-1">{index + 1}</span>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <PlaceCard place={place} />
        {note && (
          <button
            type="button"
            onClick={onEditNote}
            aria-label={`Edit the note for ${place.name}`}
            className="flex w-full cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs italic text-emerald-700 transition-colors hover:bg-accent dark:text-emerald-400"
          >
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-3 whitespace-pre-line">{note}</span>
          </button>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className={`${ICON_BUTTON} ml-1 mt-1 self-start`} aria-label={`Actions for ${place.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem className="cursor-pointer py-2" onClick={onEditNote}>
            <StickyNote />
            {note ? "Edit note" : "Add a note"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" className="cursor-pointer py-2" onClick={onRemove}>
            <Trash2 />
            Remove from list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ListDetail() {
  const listId = useParams().id as string;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: list, isLoading } = useList(listId);
  const {
    data: places = NO_PLACES,
    isLoading: placesLoading,
    isError: placesFailed,
    refetch: refetchPlaces,
  } = usePlaces({ list_id: listId });
  const { data: categories = [] } = useCategories();
  const { mapStyleUrl, markerStyle } = useMapStyle();
  const { apply } = useListEditor(listId);
  const [noteFor, setNoteFor] = useState<Place | null>(null);

  // The view lives in the URL so a refresh or Back keeps it (as on a plan).
  const view = searchParams.get("view") === "map" ? "map" : "grid";
  function setView(next: "grid" | "map") {
    router.replace(next === "map" ? `${pathname}?view=map` : pathname, { scroll: false });
  }

  // The order is the list's; the rows are the places loaded so far.
  const order = useMemo(() => (list?.items ?? []).map((i) => i.place_id), [list]);
  const items = useMemo(() => new Map((list?.items ?? []).map((i) => [i.place_id, i])), [list]);
  const rows = useMemo(() => {
    const byId = new Map(places.map((p) => [p.id, p]));
    return order.flatMap((id) => {
      const place = byId.get(id);
      return place ? [place] : [];
    });
  }, [order, places]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Positions are indexes in the list's order — the server's — not in the
  // rows shown, which can lack a place whose row is still loading.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const position = order.indexOf(String(over.id));
    if (position < 0 || !order.includes(String(active.id))) return;
    apply({ ops: [{ op: "move_place", place_id: String(active.id), position }] });
  }

  function remove(place: Place) {
    const item = items.get(place.id);
    apply(
      { ops: [{ op: "remove_place", place_id: place.id }] },
      {
        onDone: () =>
          toast(`Removed ${place.name}`, {
            action: {
              label: "Undo",
              // Back where it was, with its note.
              onClick: () =>
                apply({
                  ops: [
                    {
                      op: "add_place",
                      place_id: place.id,
                      ...(item?.note ? { note: item.note } : {}),
                      ...(item ? { position: order.indexOf(place.id) } : {}),
                    },
                  ],
                }),
            },
            duration: UNDO_TOAST_MS,
          }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">This list doesn&apos;t exist, or it was deleted.</p>
        <Link href={LISTS_HOME} className="text-sm text-emerald-600 hover:underline">
          Back to lists
        </Link>
      </div>
    );
  }

  const count = list.items.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="shrink-0 border-b px-3 py-2 sm:px-4">
        <div className="flex items-center gap-1">
          <Link
            href={LISTS_HOME}
            aria-label="Back to lists"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="min-w-0 truncate text-sm font-semibold">{list.name}</h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} place{count !== 1 ? "s" : ""}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1" role="group" aria-label="View">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 cursor-pointer"
              aria-label="List"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "map" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 cursor-pointer"
              aria-label="Map"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              <MapIcon className="h-4 w-4" />
            </Button>
            <ListMenu list={list} />
          </div>
        </div>
      </header>

      {/* Content */}
      {view === "map" ? (
        <div className="flex-1">
          <MapView
            places={rows}
            categories={categories}
            mapStyle={mapStyleUrl}
            markerStyle={markerStyle}
            className="w-full h-full"
          />
        </div>
      ) : (
        <div className="p-4 overflow-y-auto flex-1">
          <div className="max-w-2xl space-y-3">
            {list.description && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{list.description}</p>
            )}
            {count === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">
                No places in this list yet. Add one from a place&apos;s page (Lists → Add to list).
              </p>
            ) : rows.length === 0 && placesFailed ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">The places on this list couldn&apos;t be loaded.</p>
                <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => refetchPlaces()}>
                  Try again
                </Button>
              </div>
            ) : rows.length === 0 && placesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={rows.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {rows.map((place, index) => (
                      <SortablePlaceItem
                        key={place.id}
                        place={place}
                        index={index}
                        note={items.get(place.id)?.note ?? null}
                        onEditNote={() => setNoteFor(place)}
                        onRemove={() => remove(place)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      )}

      {noteFor && (
        <ListNoteDialog
          key={noteFor.id}
          listId={listId}
          placeId={noteFor.id}
          placeName={noteFor.name}
          note={items.get(noteFor.id)?.note ?? null}
          open
          onOpenChange={(open) => !open && setNoteFor(null)}
        />
      )}
    </div>
  );
}

export default function ListDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      }
    >
      <ListDetail />
    </Suspense>
  );
}
