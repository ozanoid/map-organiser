"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePlaces } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useDeleteList, useReorderListPlaces } from "@/lib/hooks/use-lists";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import { MapView } from "@/components/map/map-view";
import { PlaceCard } from "@/components/places/place-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Trash2, Map, LayoutGrid, GripVertical } from "lucide-react";
import { toast } from "sonner";
import type { PlaceList, Place } from "@/lib/types";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortablePlaceItem({ place, index }: { place: Place; index: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: place.id });

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
      {/* Card */}
      <div className="flex-1 min-w-0">
        <PlaceCard place={place} />
      </div>
    </div>
  );
}

export default function ListDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [list, setList] = useState<PlaceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "map">("grid");
  const deleteList = useDeleteList();
  const reorder = useReorderListPlaces();
  const { data: categories = [] } = useCategories();
  const { mapStyleUrl, markerStyle } = useMapStyle();

  const { data: places = [] } = usePlaces({ list_id: params.id as string });

  // Local order state for optimistic drag updates
  const [orderedPlaces, setOrderedPlaces] = useState<Place[]>([]);
  useEffect(() => {
    setOrderedPlaces(places);
  }, [places]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setOrderedPlaces((prev) => {
        const oldIndex = prev.findIndex((p) => p.id === active.id);
        const newIndex = prev.findIndex((p) => p.id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);

        // Persist to backend
        reorder.mutate({
          listId: params.id as string,
          placeIds: next.map((p) => p.id),
        });

        return next;
      });
    },
    [params.id, reorder]
  );

  useEffect(() => {
    supabase
      .from("lists")
      .select("*")
      .eq("id", params.id)
      .single()
      .then(({ data }) => {
        setList(data);
        setLoading(false);
      });
  }, [params.id, supabase]);

  function handleDelete() {
    if (!confirm("Delete this list? Places won't be deleted.")) return;
    deleteList.mutate(params.id as string, {
      onSuccess: () => {
        toast.success("List deleted");
        router.push("/lists");
      },
    });
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!list) {
    return <div className="p-6"><p className="text-muted-foreground">List not found.</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">{list.name}</h1>
          <span className="text-xs text-muted-foreground">
            {orderedPlaces.length} place{orderedPlaces.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 cursor-pointer"
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "map" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 cursor-pointer"
            onClick={() => setView("map")}
          >
            <Map className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer text-red-500"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {view === "map" ? (
        <div className="flex-1">
          <MapView
            places={orderedPlaces}
            categories={categories}
            mapStyle={mapStyleUrl}
            markerStyle={markerStyle}
            className="w-full h-full"
          />
        </div>
      ) : (
        <div className="p-4 overflow-y-auto flex-1">
          {orderedPlaces.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No places in this list yet.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedPlaces.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 max-w-2xl">
                  {orderedPlaces.map((place, index) => (
                    <SortablePlaceItem key={place.id} place={place} index={index} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}
