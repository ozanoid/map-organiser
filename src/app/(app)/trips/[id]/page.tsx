"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useTrip, useAutoPlan, useReorderTripDayPlaces,
  useRemoveTripPlace, useAddTripPlace, useMoveTripPlace, useSwapTripDays,
  useUpdateTripDay, useUpdateTripDayPlace, useUpdateTrip,
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
  Footprints, Car, Bike, Sparkles, Users, Minus,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, RoutingProfile, TripDay, TripDayPlace } from "@/lib/types";
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
          <p className="text-sm font-medium truncate flex items-center gap-1.5">
            <span className="truncate">{place.name}</span>
            {dayPlace.time_slot && (
              <span className="text-[9px] font-normal text-muted-foreground border rounded px-1 py-px shrink-0">
                {dayPlace.time_slot}
              </span>
            )}
          </p>
          {dayPlace.notes ? (
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate italic">{dayPlace.notes}</p>
          ) : place.address ? (
            <p className="text-[10px] text-muted-foreground truncate">{place.address}</p>
          ) : null}
        </div>
        <CostBadge dayPlace={dayPlace} tripId={tripId} dayId={dayId} />
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

// NF-08 (v1.22.0): inline-editable per-person cost — "$25" chip, click
// to edit, Enter/blur saves, empty clears. Defaults are seeded server-
// side from price_level; 34% of places have none, so empty renders "$+".
function CostBadge({
  dayPlace, tripId, dayId,
}: {
  dayPlace: TripDayPlace; tripId: string; dayId: string;
}) {
  const updatePlace = useUpdateTripDayPlace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function save() {
    // Validate BEFORE closing the editor; normalize comma decimals
    // ("12,50") so legit input isn't silently dropped; mirror the
    // server's 0..100000 bounds.
    const trimmed = draft.trim().replace(",", ".");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 100000)) {
      toast.error("Enter a valid cost (0–100000)");
      return;
    }
    setEditing(false);
    if (value === dayPlace.cost_estimate) return;
    updatePlace.mutate(
      { tripId, dayId, placeId: dayPlace.place_id, cost_estimate: value },
      { onError: () => toast.error("Couldn't save cost — try again") }
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-14 h-5 text-[10px] text-right border rounded px-1 bg-transparent shrink-0"
        placeholder="$"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(dayPlace.cost_estimate != null ? String(dayPlace.cost_estimate) : "");
        setEditing(true);
      }}
      className={`text-[10px] shrink-0 cursor-pointer hover:text-foreground transition-colors ${
        dayPlace.cost_estimate != null ? "text-muted-foreground" : "text-muted-foreground/40"
      }`}
      title="Per-person cost estimate"
    >
      {dayPlace.cost_estimate != null ? `$${dayPlace.cost_estimate}` : "$+"}
    </button>
  );
}

const PROFILE_CYCLE: RoutingProfile[] = ["walking", "driving", "cycling"];
const PROFILE_ICONS = { walking: Footprints, driving: Car, cycling: Bike } as const;

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

  // NF-08: per-day total (per person) from the rows currently shown.
  const dayCost = localPlaces.reduce((s, dp) => s + (dp.cost_estimate ?? 0), 0);

  // NF-07: cycle walking → driving → cycling; server refetch redraws the
  // route line automatically via ["trip", tripId] invalidation.
  const updateDay = useUpdateTripDay();
  const profile: RoutingProfile = day.routing_profile ?? "walking";
  const ProfileIcon = PROFILE_ICONS[profile];
  function cycleProfile() {
    const next = PROFILE_CYCLE[(PROFILE_CYCLE.indexOf(profile) + 1) % PROFILE_CYCLE.length];
    updateDay.mutate(
      { tripId, dayId: day.id, routing_profile: next },
      { onError: () => toast.error("Couldn't change route mode") }
    );
  }

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
        {dayCost > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0" title="Day total (per person)">
            ${Math.round(dayCost)}
          </span>
        )}
        {localPlaces.length >= 2 && (
          <button
            type="button"
            onClick={cycleProfile}
            disabled={updateDay.isPending}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer shrink-0 transition-colors"
            title={`Route mode: ${profile} — click to change`}
          >
            {updateDay.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ProfileIcon className="h-3.5 w-3.5" />
            )}
          </button>
        )}
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

      {/* AI-09: day theme + rationale (trip_days.notes, written by AI Plan) */}
      {day.notes && (
        <p className="text-[11px] text-muted-foreground italic pl-8 -mt-1 mb-1.5">{day.notes}</p>
      )}

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

// NF-08 (v1.22.0): party-size stepper — budget totals multiply by this.
function PartySizeControl({ tripId, partySize }: { tripId: string; partySize: number }) {
  const updateTrip = useUpdateTrip();

  function step(delta: number) {
    const next = Math.min(50, Math.max(1, partySize + delta));
    if (next !== partySize)
      updateTrip.mutate(
        { tripId, party_size: next },
        { onError: () => toast.error("Couldn't update party size") }
      );
  }

  return (
    <span className="inline-flex items-center gap-0.5 ml-1" title="Party size">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={partySize <= 1 || updateTrip.isPending}
        className="h-3.5 w-3.5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-default"
      >
        <Minus className="h-2.5 w-2.5" />
      </button>
      <span className="inline-flex items-center gap-0.5">
        <Users className="h-3 w-3" />
        {partySize}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={partySize >= 50 || updateTrip.isPending}
        className="h-3.5 w-3.5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-default"
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// AI-09 (v1.22.0): AI Plan entry — gated on ai-settings like every other
// AI surface (hidden until enabled AND available).
function AiPlanButton({
  tripId, totalPlaces, days,
}: {
  tripId: string; totalPlaces: number; days: TripDay[];
}) {
  const [open, setOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<{ enabled: boolean; available: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/ai-settings");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAiSettings(data);
      } catch {
        // Silent fail — the button just stays hidden.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!aiSettings?.enabled || !aiSettings.available) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer text-xs border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3.5 w-3.5 mr-1" />
        AI Plan
      </Button>
      {open && (
        <AiPlanDialog tripId={tripId} totalPlaces={totalPlaces} days={days} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

function AiPlanDialog({
  tripId, totalPlaces, days, open, onOpenChange,
}: {
  tripId: string; totalPlaces: number; days: TripDay[];
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [includePool, setIncludePool] = useState(totalPlaces === 0);
  // Prefill with the most common city among places already in the trip.
  // (Plain object — `Map` is shadowed by the lucide icon import here.)
  const defaultCity = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of days) {
      for (const dp of d.places ?? []) {
        const c = dp.place?.city;
        if (c) counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [days]);
  const [city, setCity] = useState(defaultCity);

  const plan = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/trip-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          include_pool: includePool,
          city: includePool && city.trim() ? city.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI plan failed");
      return data as { days: { day_number: number; theme: string; place_count: number }[]; placed: number; left_out: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      toast.success(`Planned ${data.days.length} days · ${data.placed} places${data.left_out ? ` (${data.left_out} left out)` : ""}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const candidateNote = includePool
    ? "Places already in the trip + your want-to-go places in the city below."
    : "Only the places already in this trip.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            AI Plan
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Distributes places across your {days.length} days by geography, theme and
            opening days — with time slots and a short rationale per day.
            Rewrites ALL day assignments (costs are kept). Uses 1 AI plan unit
            (50/month).
          </p>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includePool}
              onChange={(e) => setIncludePool(e.target.checked)}
              className="mt-0.5 accent-emerald-600"
            />
            <span className="text-xs">
              Also pull from my <b>want-to-go</b> places
              <span className="block text-muted-foreground mt-0.5">{candidateNote}</span>
            </span>
          </label>

          {includePool && (
            <Input
              placeholder="City (e.g. Amsterdam)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-9 text-sm"
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() => plan.mutate()}
              disabled={plan.isPending || (includePool && !city.trim()) || (!includePool && totalPlaces < 2)}
            >
              {plan.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Planning…
                </>
              ) : (
                "Generate plan"
              )}
            </Button>
          </div>
          {!includePool && totalPlaces < 2 && (
            <p className="text-[11px] text-muted-foreground">
              This trip has fewer than 2 places — enable the want-to-go pool or add places first.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  // NF-08: trip total = Σ per-person costs × party_size.
  const perPersonTotal = days.reduce(
    (s, d) => s + (d.places ?? []).reduce((ds, dp) => ds + (dp.cost_estimate ?? 0), 0),
    0
  );
  const partySize = trip.party_size ?? 1;

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
              {perPersonTotal > 0 && (
                <>
                  <span className="mx-0.5">·</span>
                  <span title={`$${Math.round(perPersonTotal)}/person × ${partySize}`}>
                    ≈ ${Math.round(perPersonTotal * partySize)}
                  </span>
                </>
              )}
              <PartySizeControl tripId={tripId} partySize={partySize} />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={handleShare}
            disabled={createSharedLink.isPending} title="Share trip">
            {createSharedLink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          </Button>
          <AiPlanButton tripId={tripId} totalPlaces={totalPlaces} days={days} />
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
              <p className="text-xs text-muted-foreground mt-1">Use &quot;+ Add place&quot; below each day to get started.</p>
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
