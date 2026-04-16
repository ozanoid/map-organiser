"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useTrip, useAutoPlan, useReorderTripDayPlaces,
  useRemoveTripPlace, useAddTripPlace, useMoveTripPlace, useSwapTripDays,
} from "@/lib/hooks/use-trips";
import { usePlaces } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import { useCreateSharedLink } from "@/lib/hooks/use-shared-links";
import { MapView } from "@/components/map/map-view";
import type { MapViewHandle } from "@/components/map/map-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Wand2, Map, LayoutList, Calendar, MapPin, GripVertical,
  Loader2, Share2, X, Plus, ChevronUp, ChevronDown, ArrowRightLeft, Search,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, TripDay, TripDayPlace } from "@/lib/types";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const DAY_COLORS = ["#3B82F6", "#F97316", "#8B5CF6", "#22C55E", "#EC4899", "#06B6D4", "#F59E0B"];

function SortableTripPlace({
  dayPlace, index, tripId, dayId, days, onRemove, onMove,
}: {
  dayPlace: TripDayPlace; index: number;
  tripId: string; dayId: string;
  days: TripDay[];
  onRemove: (placeId: string, name: string) => void;
  onMove: (placeId: string, targetDayId: string) => void;
}) {
  const place = dayPlace.place;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dayPlace.id });
  const [moveOpen, setMoveOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  if (!place) return null;

  const otherDays = days.filter((d) => d.id !== dayId);

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 group">
      {/* Drag handle */}
      <button
        type="button"
        className="flex items-center px-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        {...attributes}
        {...listeners}
      >
        <span className="text-xs font-medium text-muted-foreground w-4 text-center">{index + 1}</span>
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Place info */}
      <div className="flex-1 min-w-0 flex items-center gap-2 py-1.5">
        <span className="h-5 w-5 rounded-full shrink-0" style={{ backgroundColor: place.category?.color || "#6B7280" }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{place.name}</p>
          {place.address && <p className="text-[10px] text-muted-foreground truncate">{place.address}</p>}
        </div>
      </div>

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {/* Move to day */}
        {otherDays.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoveOpen(!moveOpen)}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
              title="Move to another day"
            >
              <ArrowRightLeft className="h-3 w-3" />
            </button>
            {moveOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoveOpen(false)} />
                <div className="absolute right-0 top-7 z-50 bg-white dark:bg-gray-900 rounded-lg shadow-xl border p-1 min-w-[120px]">
                  {otherDays.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { onMove(place.id, d.id); setMoveOpen(false); }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center gap-2"
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: DAY_COLORS[(d.day_number - 1) % DAY_COLORS.length] }}
                      />
                      Day {d.day_number}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Remove */}
        <button
          type="button"
          onClick={() => onRemove(place.id, place.name)}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer"
          title="Remove from trip"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function DayTimeline({
  day, dayIndex, tripId, days, totalDays,
  color, onSwapDay,
}: {
  day: TripDay; dayIndex: number; tripId: string;
  days: TripDay[]; totalDays: number;
  color: string;
  onSwapDay: (dayId: string, direction: "up" | "down") => void;
}) {
  const reorder = useReorderTripDayPlaces();
  const removeTripPlace = useRemoveTripPlace();
  const moveTripPlace = useMoveTripPlace();
  const [localPlaces, setLocalPlaces] = useState<TripDayPlace[]>(day.places || []);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { setLocalPlaces(day.places || []); }, [day.places]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalPlaces((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      const next = arrayMove(prev, oldIndex, newIndex);
      reorder.mutate({ tripId, dayId: day.id, placeIds: next.map((p) => p.place_id) });
      return next;
    });
  }, [tripId, day.id, reorder]);

  function handleRemove(placeId: string, name: string) {
    if (!confirm(`Remove "${name}" from this trip?`)) return;
    removeTripPlace.mutate({ tripId, dayId: day.id, placeId }, {
      onSuccess: () => toast.success(`Removed ${name}`),
    });
  }

  function handleMove(placeId: string, targetDayId: string) {
    moveTripPlace.mutate({ tripId, dayId: day.id, placeId, targetDayId }, {
      onSuccess: () => toast.success("Moved to another day"),
    });
  }

  const route = day.route;
  const dateStr = new Date(day.date).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <div className="mb-5">
      {/* Day header */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="h-6 w-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: color }}
        >
          {dayIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Day {dayIndex + 1}</p>
          <p className="text-[10px] text-muted-foreground">{dateStr}</p>
        </div>
        {route && (
          <div className="text-[10px] text-muted-foreground text-right shrink-0 mr-1">
            <p>{route.distance_km} km · {route.duration_min} min</p>
          </div>
        )}
        {/* Day reorder arrows */}
        <div className="flex flex-col shrink-0">
          <button
            type="button"
            disabled={dayIndex === 0}
            onClick={() => onSwapDay(day.id, "up")}
            className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-default"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={dayIndex === totalDays - 1}
            onClick={() => onSwapDay(day.id, "down")}
            className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-default"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Places */}
      {localPlaces.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-8 py-2">No places for this day</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localPlaces.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="pl-3 border-l-2 ml-3 space-y-0" style={{ borderColor: color }}>
              {localPlaces.map((dp, i) => (
                <div key={dp.id}>
                  <SortableTripPlace
                    dayPlace={dp} index={i}
                    tripId={tripId} dayId={day.id} days={days}
                    onRemove={handleRemove} onMove={handleMove}
                  />
                  {i < localPlaces.length - 1 && route?.legs?.[i] && (
                    <div className="flex items-center gap-1.5 pl-7 py-0.5">
                      <span className="text-[9px] text-muted-foreground">
                        {route.legs[i].distance_km} km · {route.legs[i].duration_min} min
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add place button */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex items-center gap-1.5 pl-8 mt-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add place
      </button>

      {addOpen && (
        <AddPlaceToDay
          tripId={tripId}
          dayId={day.id}
          existingPlaceIds={localPlaces.map((dp) => dp.place_id)}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
    </div>
  );
}

function AddPlaceToDay({
  tripId, dayId, existingPlaceIds, open, onOpenChange,
}: {
  tripId: string; dayId: string; existingPlaceIds: string[];
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { data: allPlaces = [] } = usePlaces({});
  const addPlace = useAddTripPlace();
  const [search, setSearch] = useState("");

  const filtered = allPlaces.filter((p) => {
    if (existingPlaceIds.includes(p.id)) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q);
    }
    return true;
  });

  function handleAdd(placeId: string) {
    addPlace.mutate({ tripId, dayId, placeId }, {
      onSuccess: () => { toast.success("Place added"); onOpenChange(false); },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[70dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Place to Day</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search places..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No places available</p>
          ) : (
            <div className="space-y-0.5">
              {filtered.slice(0, 50).map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => handleAdd(place.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center gap-2.5 transition-colors"
                >
                  <span className="h-5 w-5 rounded-full shrink-0" style={{ backgroundColor: place.category?.color || "#6B7280" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{place.name}</p>
                    {place.address && <p className="text-[10px] text-muted-foreground truncate">{place.address}</p>}
                  </div>
                  {place.category && <Badge variant="secondary" className="text-[10px] shrink-0">{place.category.name}</Badge>}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TripDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: categories = [] } = useCategories();
  const { mapStyleUrl, markerStyle } = useMapStyle();
  const autoPlan = useAutoPlan();
  const createSharedLink = useCreateSharedLink();
  const swapDays = useSwapTripDays();
  const mapRef = useRef<MapViewHandle>(null);
  const [view, setView] = useState<"timeline" | "map">("timeline");
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  const allPlaces = useMemo(() => {
    if (!trip?.days) return [];
    return trip.days.flatMap((day) => (day.places || []).map((dp) => dp.place).filter(Boolean) as Place[]);
  }, [trip?.days]);

  const mapPlaces = useMemo(() => {
    if (selectedDayIndex === null || !trip?.days) return allPlaces;
    const day = trip.days[selectedDayIndex];
    return (day?.places || []).map((dp) => dp.place).filter(Boolean) as Place[];
  }, [selectedDayIndex, trip?.days, allPlaces]);

  const routeLines = useMemo(() => {
    if (!trip?.days) return [];
    return trip.days
      .filter((day) => day.route?.geometry?.coordinates)
      .filter((_, i) => selectedDayIndex === null || selectedDayIndex === i)
      .map((day) => ({
        id: `route-day-${day.day_number}`,
        color: DAY_COLORS[(day.day_number - 1) % DAY_COLORS.length],
        coordinates: day.route!.geometry.coordinates,
      }));
  }, [trip?.days, selectedDayIndex]);

  function handleShare() {
    createSharedLink.mutate(
      { resource_type: "trip", resource_id: tripId },
      {
        onSuccess: (link) => {
          navigator.clipboard.writeText(`${window.location.origin}/shared/${link.slug}`);
          toast.success("Link copied to clipboard!");
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function handleAutoPlan() {
    autoPlan.mutate(tripId, {
      onSuccess: () => toast.success("Places distributed across days"),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleSwapDay(dayId: string, direction: "up" | "down") {
    swapDays.mutate({ tripId, dayId, direction });
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!trip) {
    return <div className="p-6"><p className="text-muted-foreground">Trip not found.</p></div>;
  }

  const days = trip.days || [];
  const totalPlaces = days.reduce((s, d) => s + (d.places?.length || 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm truncate">{trip.name}</h1>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {days.length}
              <span className="mx-0.5">·</span>
              <MapPin className="h-3 w-3" />
              {totalPlaces}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={handleShare}
            disabled={createSharedLink.isPending} title="Share trip">
            {createSharedLink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          </Button>
          {totalPlaces > 0 && (
            <Button variant="outline" size="sm" className="cursor-pointer text-xs" onClick={handleAutoPlan} disabled={autoPlan.isPending}>
              {autoPlan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
              Auto Plan
            </Button>
          )}
          <Button variant={view === "timeline" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 cursor-pointer" onClick={() => setView("timeline")}>
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button variant={view === "map" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 cursor-pointer" onClick={() => setView("map")}>
            <Map className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {view === "map" ? (
        <div className="flex-1 relative">
          <MapView
            ref={mapRef} places={mapPlaces} categories={categories}
            mapStyle={mapStyleUrl} markerStyle={markerStyle}
            routeLines={routeLines} className="w-full h-full"
          />
          {days.length > 1 && (
            <div className="absolute bottom-20 lg:bottom-4 left-4 right-4 z-10 flex gap-2 justify-center flex-wrap">
              <button type="button" onClick={() => setSelectedDayIndex(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  selectedDayIndex === null ? "bg-emerald-600 text-white" : "bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-300 shadow-md"
                }`}>All</button>
              {days.map((day, i) => (
                <button key={day.id} type="button"
                  onClick={() => setSelectedDayIndex(selectedDayIndex === i ? null : i)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors shadow-md"
                  style={{
                    backgroundColor: selectedDayIndex === i ? DAY_COLORS[i % DAY_COLORS.length] : undefined,
                    color: selectedDayIndex === i ? "#fff" : DAY_COLORS[i % DAY_COLORS.length],
                    border: selectedDayIndex !== i ? `2px solid ${DAY_COLORS[i % DAY_COLORS.length]}` : undefined,
                  }}>Day {i + 1}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {totalPlaces === 0 && !autoPlan.isPending ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MapPin className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-muted-foreground">No places in this trip yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Use "+ Add place" below each day to get started.</p>
            </div>
          ) : (
            <div className="max-w-xl">
              {days.map((day, i) => (
                <DayTimeline
                  key={day.id}
                  day={day} dayIndex={i} tripId={tripId}
                  days={days} totalDays={days.length}
                  color={DAY_COLORS[i % DAY_COLORS.length]}
                  onSwapDay={handleSwapDay}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
