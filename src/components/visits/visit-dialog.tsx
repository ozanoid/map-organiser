"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEditVisit, useLogVisit, useVisits, type VisitWriteResult } from "@/lib/hooks/use-visits";
import { todayIso } from "@/lib/plans/dates";
import type { Visit } from "@/lib/types";
import { StarRatingInput } from "./rating";
import { visitDateLabel } from "./visit-date";

/** What the dialog opens on: a new visit to a place (optionally the visit
 *  that fulfils a planned stop), or an existing visit to correct. */
export type VisitDialogTarget =
  | { kind: "log"; placeId: string; placeName: string; planStopId?: string; defaultDate: string }
  | { kind: "edit"; placeName: string; visit: Pick<Visit, "id" | "visited_on" | "rating" | "notes"> };

/**
 * Log a visit or correct one: date, rating (optional), notes (optional).
 *
 * A place has one visit per day. When the date picked for a new visit
 * already has one, the dialog shows that visit's rating and notes and saving
 * updates it — so nothing typed earlier is overwritten unseen.
 */
export function VisitDialog({
  target,
  open,
  onOpenChange,
  onSaved,
}: {
  target: VisitDialogTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (result: VisitWriteResult) => void;
}) {
  const logVisit = useLogVisit();
  const editVisit = useEditVisit();
  const placeId = target.kind === "log" ? target.placeId : undefined;
  const { data: placeVisits = [] } = useVisits(placeId);
  const today = todayIso();

  const [date, setDate] = useState(target.kind === "log" ? target.defaultDate : target.visit.visited_on);
  // What the user changed; undefined = not touched (show the stored value).
  const [ratingDraft, setRatingDraft] = useState<number | null | undefined>(
    target.kind === "edit" ? target.visit.rating : undefined
  );
  const [notesDraft, setNotesDraft] = useState<string | undefined>(
    target.kind === "edit" ? (target.visit.notes ?? "") : undefined
  );

  const sameDay = target.kind === "log" ? placeVisits.find((v) => v.visited_on === date) : undefined;
  const rating = ratingDraft !== undefined ? ratingDraft : (sameDay?.rating ?? null);
  const notes = notesDraft !== undefined ? notesDraft : (sameDay?.notes ?? "");
  const pending = logVisit.isPending || editVisit.isPending;
  const future = !!date && date > today;

  function done(result: VisitWriteResult) {
    toast.success(result.created ? "Visit saved" : "Visit updated");
    onSaved?.(result);
    onOpenChange(false);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!date || future || pending) return;
    const fields = { rating, notes: notes.trim() ? notes.trim() : null };
    if (target.kind === "edit") {
      editVisit.mutate(
        { id: target.visit.id, ...(date !== target.visit.visited_on ? { visited_on: date } : {}), ...fields },
        { onSuccess: done, onError: (err) => toast.error(err.message) }
      );
    } else {
      logVisit.mutate(
        {
          place_id: target.placeId,
          ...(target.planStopId ? { plan_stop_id: target.planStopId } : {}),
          visited_on: date,
          ...fields,
        },
        { onSuccess: done, onError: (err) => toast.error(err.message) }
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target.kind === "edit" ? "Edit visit" : "Log a visit"}</DialogTitle>
          <DialogDescription>
            {target.placeName}
            {target.kind === "log" && target.planStopId ? " — marks the stop done in your plan" : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <label className="block text-xs font-medium text-muted-foreground">
            Date
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={future || undefined}
              className="mt-1 h-10"
              required
            />
          </label>
          {future && <p className="-mt-2 text-xs text-destructive">A visit can&apos;t be in the future.</p>}
          {sameDay && (
            <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
              You already logged a visit on {visitDateLabel(sameDay.visited_on)} — saving updates it.
            </p>
          )}

          <div>
            <span className="block text-xs font-medium text-muted-foreground">
              Your rating <span className="font-normal">(optional)</span>
            </span>
            <div className="mt-1">
              <StarRatingInput value={rating} onChange={setRatingDraft} disabled={pending} />
            </div>
          </div>

          <label className="block text-xs font-medium text-muted-foreground">
            Notes <span className="font-normal">(optional)</span>
            <Textarea
              value={notes}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="What did you have? How was it?"
              maxLength={2000}
              rows={3}
              className="mt-1"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!date || future || pending}>
              {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save visit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
