"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useListEditor } from "./use-list-editor";

const MAX_NOTE = 2000;

/**
 * The note on one place in one list — why it is on the list, what to order
 * there. A dialog rather than inline editing: on a phone the keyboard needs
 * the room. Saving an empty note clears it.
 */
export function ListNoteDialog({
  listId,
  placeId,
  placeName,
  note,
  open,
  onOpenChange,
}: {
  listId: string;
  placeId: string;
  placeName: string;
  note: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply, isPending } = useListEditor(listId);
  const [draft, setDraft] = useState(note ?? "");
  const trimmed = draft.trim();
  const unchanged = trimmed === (note ?? "").trim();

  function save(value: string | null) {
    if (value === (note ?? null) || (value === null && !note)) return onOpenChange(false);
    apply({ ops: [{ op: "set_note", place_id: placeId, note: value }] }, { onDone: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "Add a note"}</DialogTitle>
          <DialogDescription className="truncate">{placeName} — on this list only</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(trimmed || null);
          }}
        >
          <Textarea
            aria-label={`Note for ${placeName}`}
            placeholder="Why it's on the list, what to order…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_NOTE}
            rows={5}
            autoFocus
          />
          <div className="flex items-center gap-2">
            {note && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer text-destructive hover:text-destructive"
                disabled={isPending}
                onClick={() => save(null)}
              >
                Clear note
              </Button>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {draft.length > MAX_NOTE - 200 ? `${draft.length} / ${MAX_NOTE}` : ""}
            </span>
            <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="cursor-pointer" disabled={isPending || unchanged}>
              {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
