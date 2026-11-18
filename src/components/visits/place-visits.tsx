"use client";

import Link from "next/link";
import { CalendarCheck, Compass, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Visit } from "@/lib/types";
import { RatingStars } from "./rating";
import { visitDateLabel } from "./visit-date";

/** One line under the visit status: how often and when last, and the way
 *  to log a visit. */
export function PlaceVisitSummary({
  visits,
  loading,
  onLog,
}: {
  visits: Visit[];
  loading: boolean;
  onLog: () => void;
}) {
  const last = visits[0];
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {loading ? (
          <Skeleton className="h-3.5 w-32" />
        ) : last ? (
          <span className="truncate">
            {visits.length} visit{visits.length === 1 ? "" : "s"} · last on {visitDateLabel(last.visited_on)}
          </span>
        ) : (
          <span>No visits logged yet</span>
        )}
      </p>
      <Button variant="outline" size="sm" className="shrink-0 cursor-pointer" onClick={onLog}>
        <Plus className="h-3.5 w-3.5" />
        Log a visit
      </Button>
    </div>
  );
}

/** The place's visits, newest first, each with its rating, notes and the
 *  plan it came from. */
export function PlaceVisitList({
  visits,
  onLog,
  onEdit,
  onDelete,
}: {
  visits: Visit[];
  onLog: () => void;
  onEdit: (visit: Visit) => void;
  onDelete: (visit: Visit) => void;
}) {
  return (
    <section className="space-y-2" aria-label="Visits">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Visits {visits.length > 0 && <span className="font-normal text-muted-foreground">{visits.length}</span>}
        </h2>
        <Button variant="ghost" size="sm" className="cursor-pointer text-xs" onClick={onLog}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {visits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          When you go, log it here — the date, your rating and what you had.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visits.map((visit) => (
            <li key={visit.id} className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{visitDateLabel(visit.visited_on)}</span>
                  {visit.rating != null && <RatingStars value={visit.rating} />}
                </div>
                {visit.notes && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{visit.notes}</p>
                )}
                {visit.plan && (
                  <Link
                    href={`/plans/${visit.plan.id}`}
                    prefetch={false}
                    className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Compass className="h-3 w-3" aria-hidden />
                    {visit.plan.name}
                  </Link>
                )}
              </div>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label={`Edit the visit on ${visitDateLabel(visit.visited_on)}`}
                onClick={() => onEdit(visit)}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={`${ICON_BUTTON} hover:text-destructive`}
                aria-label={`Delete the visit on ${visitDateLabel(visit.visited_on)}`}
                onClick={() => onDelete(visit)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
