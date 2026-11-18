"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { CheckCircle2, Clock, GripVertical, MoreHorizontal, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dayColor } from "@/lib/plans/day-colors";
import { DAY_PARTS } from "@/lib/plans/schema";
import { cn } from "@/lib/utils";
import type { DayPart, PlanDay, PlanStop } from "@/lib/types";
import { ICON_BUTTON, UNDO_TOAST_MS, usePlanEditor } from "./use-plan-editor";

const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export function stopLabel(stop: PlanStop): string {
  return stop.place?.name ?? stop.title ?? "Stop";
}

/**
 * One stop of a day: drag handle, what it is, when, the per-person cost and
 * a menu (move to another day, remove).
 *
 * `apply` is the day's: "Undo" in the toast runs after this row is gone, and
 * a change sent through an unmounted row's own hook would fail silently.
 */
export function StopRow({
  planId,
  stop,
  index,
  dayId,
  days,
  readOnly,
  apply,
}: {
  planId: string;
  stop: PlanStop;
  index: number;
  dayId: string;
  days: PlanDay[];
  readOnly: boolean;
  apply: ReturnType<typeof usePlanEditor>["apply"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
    disabled: readOnly,
  });

  const label = stopLabel(stop);
  const otherDays = days.filter((d) => d.id !== dayId);

  function remove() {
    // Undo puts back a stop with the same content at the same place. What
    // it can't put back is a stop's outcome (done / skipped, and the visit
    // linked to it) — so it is offered for planned stops only.
    const undo =
      stop.status === "planned"
        ? {
            label: "Undo",
            onClick: () =>
              apply({
                ops: [
                  {
                    op: "add_stop",
                    day_id: dayId,
                    position: index,
                    ...(stop.place_id ? { place_id: stop.place_id } : { title: stop.title ?? label }),
                    ...(stop.start_time ? { start_time: stop.start_time } : {}),
                    ...(stop.day_part ? { day_part: stop.day_part } : {}),
                    ...(stop.notes ? { notes: stop.notes } : {}),
                    // Explicit, also when empty: a cleared cost stays cleared.
                    cost_estimate: stop.cost_estimate,
                    ...(stop.currency ? { currency: stop.currency } : {}),
                  },
                ],
              }),
          }
        : undefined;
    apply(
      { ops: [{ op: "remove_stop", stop_id: stop.id }] },
      { onDone: () => toast(`Removed ${label}`, undo ? { action: undo, duration: UNDO_TOAST_MS } : undefined) }
    );
  }

  function moveTo(day: PlanDay) {
    apply(
      { ops: [{ op: "move_stop", stop_id: stop.id, day_id: day.id }] },
      { onDone: () => toast.success(`Moved to Day ${day.day_number}`) }
    );
  }

  const subline = stop.notes ?? stop.place?.address ?? null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.8 : 1,
      }}
      className="flex items-center gap-1"
    >
      {readOnly ? (
        <span className="w-8 shrink-0 text-center text-xs font-medium text-muted-foreground">{index + 1}</span>
      ) : (
        <button
          type="button"
          aria-label={`Reorder ${label}`}
          className="flex h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <span className="w-3.5 text-center text-xs font-medium">{index + 1}</span>
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
        {stop.status === "done" ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
        ) : stop.place ? (
          <span
            className="h-5 w-5 shrink-0 rounded-full"
            style={{ backgroundColor: stop.place.category?.color || "#6B7280" }}
          />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
            <StickyNote className="h-3 w-3 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className={cn("truncate", stop.status === "skipped" && "text-muted-foreground line-through")}>
              {label}
            </span>
            {stop.status === "skipped" && (
              <span className="shrink-0 rounded border px-1 py-px text-[10px] font-normal text-muted-foreground">
                skipped
              </span>
            )}
          </p>
          {subline && (
            <p
              className={cn(
                "truncate text-[11px]",
                stop.notes ? "italic text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
              )}
            >
              {subline}
            </p>
          )}
        </div>
      </div>

      <StopTime planId={planId} stop={stop} readOnly={readOnly} />
      <CostBadge planId={planId} stop={stop} readOnly={readOnly} />

      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger className={ICON_BUTTON} aria-label={`Actions for ${label}`}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {otherDays.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  {otherDays.map((d) => (
                    <DropdownMenuItem
                      key={d.id}
                      className="cursor-pointer py-2"
                      onClick={() => moveTo(d)}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: dayColor(d.day_number) }}
                      />
                      Day {d.day_number}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem variant="destructive" className="cursor-pointer py-2" onClick={remove}>
              <Trash2 />
              Remove from plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** When the stop happens: an exact time or a part of the day — never both
 *  (setting one clears the other on the server). */
function StopTime({ planId, stop, readOnly }: { planId: string; stop: PlanStop; readOnly: boolean }) {
  const { apply } = usePlanEditor(planId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const shown = stop.start_time ?? (stop.day_part ? DAY_PART_LABELS[stop.day_part].toLowerCase() : null);

  if (readOnly) {
    return shown ? (
      <span className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">{shown}</span>
    ) : null;
  }

  function save(change: { start_time: string | null } | { day_part: DayPart | null }) {
    setOpen(false);
    apply({ ops: [{ op: "update_stop", stop_id: stop.id, ...change }] });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(stop.start_time ?? "");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={shown ? `Time: ${shown} — change` : "Set a time"}
        className={cn(
          "relative inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 text-[11px] transition-colors",
          "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
          shown ? "text-foreground" : "text-muted-foreground/60"
        )}
      >
        {shown ? <span className="rounded border px-1.5 py-0.5">{shown}</span> : <Clock className="h-3.5 w-3.5" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft) save({ start_time: draft });
          }}
        >
          <label className="flex-1 text-xs font-medium text-muted-foreground">
            Exact time
            <input
              type="time"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2 text-sm text-foreground"
            />
          </label>
          <Button type="submit" size="sm" className="h-9 cursor-pointer" disabled={!draft}>
            Set
          </Button>
        </form>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">or a part of the day</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DAY_PARTS.map((part) => (
              <Button
                key={part}
                type="button"
                size="sm"
                variant={stop.day_part === part ? "secondary" : "outline"}
                className="h-9 cursor-pointer"
                onClick={() => save({ day_part: part })}
              >
                {DAY_PART_LABELS[part]}
              </Button>
            ))}
          </div>
        </div>
        {shown && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 cursor-pointer text-muted-foreground"
            onClick={() => save(stop.start_time ? { start_time: null } : { day_part: null })}
          >
            Clear time
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Per-person cost estimate: a "$25" chip, tap to edit, Enter or leaving the
 *  field saves, empty clears. Seeded from the place's price level; where
 *  that is unknown the chip reads "$+". */
function CostBadge({ planId, stop, readOnly }: { planId: string; stop: PlanStop; readOnly: boolean }) {
  const { apply } = usePlanEditor(planId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (readOnly) {
    return stop.cost_estimate != null ? (
      <span className="shrink-0 text-[11px] text-muted-foreground">${stop.cost_estimate}</span>
    ) : null;
  }

  function save() {
    // Validate BEFORE closing the editor; accept a comma decimal ("12,50");
    // the bounds are the server's.
    const trimmed = draft.trim().replace(",", ".");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 100000)) {
      toast.error("Enter a valid cost (0–100000)");
      return;
    }
    setEditing(false);
    if (value === stop.cost_estimate) return;
    apply({ ops: [{ op: "update_stop", stop_id: stop.id, cost_estimate: value }] });
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        aria-label="Cost per person"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-8 w-16 shrink-0 rounded border bg-transparent px-1.5 text-right text-xs"
        placeholder="$"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(stop.cost_estimate != null ? String(stop.cost_estimate) : "");
        setEditing(true);
      }}
      aria-label={
        stop.cost_estimate != null
          ? `Cost per person: $${stop.cost_estimate} — change`
          : "Add a cost per person"
      }
      className={cn(
        "relative inline-flex h-9 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md px-1 text-[11px] transition-colors",
        "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        stop.cost_estimate != null ? "text-muted-foreground" : "text-muted-foreground/50"
      )}
    >
      {stop.cost_estimate != null ? `$${stop.cost_estimate}` : "$+"}
    </button>
  );
}
