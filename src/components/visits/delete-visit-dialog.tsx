"use client";

import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDeleteVisit } from "@/lib/hooks/use-visits";
import type { PlaceVisitSummary } from "@/lib/types";
import { visitDateLabel } from "./visit-date";

/** Confirms deleting a visit — its rating and notes go for good. */
export function DeleteVisitDialog({
  visit,
  fulfilsStop,
  open,
  onOpenChange,
  onDeleted,
}: {
  visit: { id: string; visited_on: string };
  /** The visit ticks off a planned stop, which becomes planned again. */
  fulfilsStop: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (result: { place: PlaceVisitSummary; reopened_stop_id: string | null }) => void;
}) {
  const deleteVisit = useDeleteVisit();
  return (
    <Dialog open={open} onOpenChange={(next) => (deleteVisit.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete the visit on {visitDateLabel(visit.visited_on)}?</DialogTitle>
          <DialogDescription>
            Its rating and notes are removed for good.
            {fulfilsStop ? " The stop in your plan goes back to planned." : ""} The place stays marked visited.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={deleteVisit.isPending}
            onClick={() => onOpenChange(false)}
          >
            Keep visit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="cursor-pointer"
            disabled={deleteVisit.isPending}
            onClick={() =>
              deleteVisit.mutate(visit.id, {
                onSuccess: (result) => {
                  toast.success("Visit deleted");
                  onDeleted?.(result);
                  onOpenChange(false);
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            {deleteVisit.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Delete visit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
