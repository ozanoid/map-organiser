"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, Bike, Car, Footprints, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDayDate } from "@/lib/plans/dates";
import { dayColor } from "@/lib/plans/day-colors";
import { ROUTING_PROFILES } from "@/lib/plans/schema";
import type { PlanDay, PlanRoute, PlanStop, RoutingProfile } from "@/lib/types";
import { AddStopDialog } from "./add-stop-dialog";
import { StopRow } from "./stop-row";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { usePlanEditor } from "./use-plan-editor";

const PROFILE_ICONS = { walking: Footprints, driving: Car, cycling: Bike } as const;

/**
 * One day of a plan: header (date, cost, route mode, menu), its stops in
 * order with the legs between them, and "Add stop".
 *
 * `route` is undefined while it loads and null when the day has none.
 * `busy` is true while another write to the plan is on its way; the day
 * controls wait for it. Every change names its day by id, so one that was
 * queued behind a renumbering still lands on the day shown here.
 */
export function PlanDayTimeline({
  planId,
  day,
  days,
  route,
  readOnly,
  busy,
}: {
  planId: string;
  day: PlanDay;
  days: PlanDay[];
  route: PlanRoute | null | undefined;
  readOnly: boolean;
  busy: boolean;
}) {
  const { apply } = usePlanEditor(planId);
  const [addOpen, setAddOpen] = useState(false);

  // A drag shows its result at once. The override belongs to the stops
  // array it was made from: when the server's answer replaces that array
  // the override no longer applies, without an effect to clear it.
  const serverStops = useMemo(() => day.stops ?? [], [day.stops]);
  const [dragged, setDragged] = useState<{ from: PlanStop[]; order: PlanStop[] } | null>(null);
  const reordering = dragged?.from === serverStops;
  const stops = reordering ? dragged.order : serverStops;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = stops.findIndex((s) => s.id === active.id);
      const newIndex = stops.findIndex((s) => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const order = arrayMove(stops, oldIndex, newIndex);
      setDragged({ from: serverStops, order });
      apply(
        { ops: [{ op: "reorder_stops", day_id: day.id, stop_ids: order.map((s) => s.id) }] },
        { onFail: () => setDragged(null) }
      );
    },
    [apply, day.id, serverStops, stops]
  );

  const color = dayColor(day.day_number);
  const dayCost = stops.reduce((sum, s) => sum + (s.cost_estimate ?? 0), 0);
  const locatedCount = stops.filter((s) => s.place?.location).length;
  const ProfileIcon = PROFILE_ICONS[day.routing_profile];
  const index = days.findIndex((d) => d.id === day.id);
  const previous = days[index - 1];
  const next = days[index + 1];

  function cycleProfile() {
    const profile: RoutingProfile =
      ROUTING_PROFILES[(ROUTING_PROFILES.indexOf(day.routing_profile) + 1) % ROUTING_PROFILES.length];
    apply({ ops: [{ op: "set_day", day_id: day.id, routing_profile: profile }] });
  }

  const subtitle = [
    day.date ? formatDayDate(day.date) : null,
    route ? `${route.distance_km} km · ${route.duration_min} min` : null,
  ].filter(Boolean);

  return (
    <section className="mb-6" aria-label={`Day ${day.day_number}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {day.day_number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Day {day.day_number}</h2>
          {(subtitle.length > 0 || route === undefined) && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {subtitle.join(" · ")}
              {route === undefined && <Loader2 className="h-3 w-3 animate-spin" aria-label="Loading route" />}
            </p>
          )}
        </div>
        {dayCost > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground" title="Day total, per person">
            ${Math.round(dayCost)}
          </span>
        )}
        {locatedCount >= 2 && !readOnly && (
          <button
            type="button"
            onClick={cycleProfile}
            disabled={busy}
            className={ICON_BUTTON}
            aria-label={`Route mode: ${day.routing_profile} — change`}
            title={`Route mode: ${day.routing_profile}`}
          >
            <ProfileIcon className="h-4 w-4" />
          </button>
        )}
        {!readOnly && days.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger className={ICON_BUTTON} aria-label={`Actions for day ${day.day_number}`}>
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                className="cursor-pointer py-2"
                disabled={!previous || busy}
                onClick={() => previous && apply({ ops: [{ op: "swap_days", a_id: day.id, b_id: previous.id }] })}
              >
                <ArrowUp />
                Move day earlier
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer py-2"
                disabled={!next || busy}
                onClick={() => next && apply({ ops: [{ op: "swap_days", a_id: day.id, b_id: next.id }] })}
              >
                <ArrowDown />
                Move day later
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer py-2"
                disabled={stops.length > 0 || busy}
                onClick={() => apply({ ops: [{ op: "remove_day", day_id: day.id }] })}
              >
                <Trash2 />
                {stops.length > 0 ? "Remove day (empty days only)" : "Remove day"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {day.notes && <p className="mb-1.5 pl-8 text-xs italic text-muted-foreground">{day.notes}</p>}

      {stops.length === 0 ? (
        <p className="py-1.5 pl-8 text-xs text-muted-foreground">No stops yet</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="ml-3 border-l-2 pl-2" style={{ borderColor: color }}>
              {stops.map((stop, i) => {
                // The route is for the order the server knows; while a
                // drag is being saved its legs would sit between the
                // wrong stops.
                const leg = reordering ? undefined : route?.legs.find((l) => l.from_stop_id === stop.id);
                return (
                  <div key={stop.id}>
                    <StopRow
                      planId={planId}
                      stop={stop}
                      index={i}
                      dayId={day.id}
                      days={days}
                      readOnly={readOnly}
                      apply={apply}
                    />
                    {leg && i < stops.length - 1 && (
                      <p className="py-0.5 pl-9 text-[10px] text-muted-foreground">
                        {leg.distance_km} km · {leg.duration_min} min
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!readOnly && (
        <>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="ml-6 mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-3.5 w-3.5" />
            Add stop
          </button>
          {addOpen && (
            <AddStopDialog
              planId={planId}
              day={day}
              placeIdsInDay={stops.flatMap((s) => (s.place_id ? [s.place_id] : []))}
              open={addOpen}
              onOpenChange={setAddOpen}
            />
          )}
        </>
      )}
    </section>
  );
}
