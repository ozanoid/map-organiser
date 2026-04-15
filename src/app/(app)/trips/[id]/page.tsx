"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTrip, useAutoPlan, useReorderTripDayPlaces } from "@/lib/hooks/use-trips";
import { useCategories } from "@/lib/hooks/use-categories";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import { MapView } from "@/components/map/map-view";
import type { MapViewHandle } from "@/components/map/map-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Wand2, Map, LayoutList, Calendar, MapPin, GripVertical, Loader2,
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

function SortableTripPlace({ dayPlace, index }: { dayPlace: TripDayPlace; index: number }) {
  const place = dayPlace.place;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dayPlace.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  if (!place) return null;

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        className="flex items-center px-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        {...attributes}
        {...listeners}
      >
        <span className="text-xs font-medium text-muted-foreground w-4 text-center">{index + 1}</span>
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-2 py-2">
        <span
          className="h-5 w-5 rounded-full shrink-0"
          style={{ backgroundColor: place.category?.color || "#6B7280" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{place.name}</p>
          {place.address && <p className="text-[10px] text-muted-foreground truncate">{place.address}</p>}
        </div>
        {place.category && (
          <Badge variant="secondary" className="text-[10px] shrink-0">{place.category.name}</Badge>
        )}
      </div>
    </div>
  );
}

function DayTimeline({
  day,
  dayIndex,
  tripId,
  color,
}: {
  day: TripDay;
  dayIndex: number;
  tripId: string;
  color: string;
}) {
  const reorder = useReorderTripDayPlaces();
  const [localPlaces, setLocalPlaces] = useState<TripDayPlace[]>(day.places || []);

  useEffect(() => {
    setLocalPlaces(day.places || []);
  }, [day.places]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setLocalPlaces((prev) => {
        const oldIndex = prev.findIndex((p) => p.id === active.id);
        const newIndex = prev.findIndex((p) => p.id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);
        reorder.mutate({
          tripId,
          dayId: day.id,
          placeIds: next.map((p) => p.place_id),
        });
        return next;
      });
    },
    [tripId, day.id, reorder]
  );

  const route = day.route;
  const dateStr = new Date(day.date).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <div className="mb-4">
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
          <div className="text-[10px] text-muted-foreground text-right shrink-0">
            <p>{route.distance_km} km</p>
            <p>{route.duration_min} min walk</p>
          </div>
        )}
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
                  <SortableTripPlace dayPlace={dp} index={i} />
                  {/* Leg info between places */}
                  {i < localPlaces.length - 1 && route?.legs?.[i] && (
                    <div className="flex items-center gap-1.5 pl-7 py-0.5">
                      <div className="h-3 w-px" style={{ backgroundColor: color }} />
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
    </div>
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
  const mapRef = useRef<MapViewHandle>(null);
  const [view, setView] = useState<"timeline" | "map">("timeline");
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  // Collect all places for the map
  const allPlaces = useMemo(() => {
    if (!trip?.days) return [];
    return trip.days.flatMap((day) =>
      (day.places || []).map((dp) => dp.place).filter(Boolean) as Place[]
    );
  }, [trip?.days]);

  // Places for selected day (or all)
  const mapPlaces = useMemo(() => {
    if (selectedDayIndex === null || !trip?.days) return allPlaces;
    const day = trip.days[selectedDayIndex];
    return (day?.places || []).map((dp) => dp.place).filter(Boolean) as Place[];
  }, [selectedDayIndex, trip?.days, allPlaces]);

  // Route lines for the map
  const routeLines = useMemo(() => {
    if (!trip?.days) return [];
    return trip.days
      .filter((day) => day.route?.geometry?.coordinates)
      .filter((_, i) => selectedDayIndex === null || selectedDayIndex === i)
      .map((day, displayIdx) => ({
        id: `route-day-${day.day_number}`,
        color: DAY_COLORS[(day.day_number - 1) % DAY_COLORS.length],
        coordinates: day.route!.geometry.coordinates,
      }));
  }, [trip?.days, selectedDayIndex]);

  function handleAutoPlan() {
    autoPlan.mutate(tripId, {
      onSuccess: () => toast.success("Places distributed across days"),
      onError: (err) => toast.error(err.message),
    });
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
          {totalPlaces > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer text-xs"
              onClick={handleAutoPlan}
              disabled={autoPlan.isPending}
            >
              {autoPlan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
              Auto Plan
            </Button>
          )}
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            size="icon" className="h-8 w-8 cursor-pointer"
            onClick={() => setView("timeline")}
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "map" ? "secondary" : "ghost"}
            size="icon" className="h-8 w-8 cursor-pointer"
            onClick={() => setView("map")}
          >
            <Map className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {view === "map" ? (
        <div className="flex-1 relative">
          <MapView
            ref={mapRef}
            places={mapPlaces}
            categories={categories}
            mapStyle={mapStyleUrl}
            markerStyle={markerStyle}
            routeLines={routeLines}
            className="w-full h-full"
          />
          {/* Day selector pills */}
          {days.length > 1 && (
            <div className="absolute bottom-20 lg:bottom-4 left-4 right-4 z-10 flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => setSelectedDayIndex(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  selectedDayIndex === null
                    ? "bg-emerald-600 text-white"
                    : "bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-300 shadow-md"
                }`}
              >
                All
              </button>
              {days.map((day, i) => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelectedDayIndex(selectedDayIndex === i ? null : i)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors shadow-md"
                  style={{
                    backgroundColor: selectedDayIndex === i ? DAY_COLORS[i % DAY_COLORS.length] : undefined,
                    color: selectedDayIndex === i ? "#fff" : DAY_COLORS[i % DAY_COLORS.length],
                    border: selectedDayIndex !== i ? `2px solid ${DAY_COLORS[i % DAY_COLORS.length]}` : undefined,
                  }}
                >
                  Day {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {totalPlaces === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MapPin className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-muted-foreground">No places in this trip yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Go back and create the trip from an existing list, or add places to a list first.
              </p>
            </div>
          ) : (
            <div className="max-w-xl">
              {days.map((day, i) => (
                <DayTimeline
                  key={day.id}
                  day={day}
                  dayIndex={i}
                  tripId={tripId}
                  color={DAY_COLORS[i % DAY_COLORS.length]}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
