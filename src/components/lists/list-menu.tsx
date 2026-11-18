"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlignLeft, Loader2, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteList } from "@/lib/hooks/use-lists";
import { useCreateSharedLink } from "@/lib/hooks/use-shared-links";
import type { PlaceList } from "@/lib/types";
import { useListEditor } from "./use-list-editor";

export const LISTS_HOME = "/lists";

/** The list's own actions: share, rename, describe, delete — the plan menu's
 *  twin (src/components/plans/plan-menu.tsx). */
export function ListMenu({ list }: { list: PlaceList }) {
  const createSharedLink = useCreateSharedLink();
  const [renameOpen, setRenameOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function share() {
    createSharedLink.mutate(
      { resource_type: "list", resource_id: list.id },
      {
        onSuccess: async (link) => {
          const url = `${window.location.origin}/shared/${link.slug}`;
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied to clipboard");
          } catch {
            // No clipboard access (permissions, an insecure origin): show it.
            toast(url, { duration: 15000 });
          }
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={ICON_BUTTON} aria-label="List actions">
          {createSharedLink.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem className="cursor-pointer py-2" onClick={share}>
            <Share2 />
            Copy share link
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => setRenameOpen(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => setDescribeOpen(true)}>
            <AlignLeft />
            {list.description ? "Edit description" : "Add a description"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="cursor-pointer py-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            Delete list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && <RenameDialog list={list} open={renameOpen} onOpenChange={setRenameOpen} />}
      {describeOpen && <DescriptionDialog list={list} open={describeOpen} onOpenChange={setDescribeOpen} />}
      {deleteOpen && <DeleteDialog list={list} open={deleteOpen} onOpenChange={setDeleteOpen} />}
    </>
  );
}

function RenameDialog({
  list,
  open,
  onOpenChange,
}: {
  list: PlaceList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply, isPending } = useListEditor(list.id);
  const [name, setName] = useState(list.name);
  const trimmed = name.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename list</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed || trimmed === list.name) return onOpenChange(false);
            apply({ set: { name: trimmed } }, { onDone: () => onOpenChange(false) });
          }}
        >
          <Input
            aria-label="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <Button type="submit" className="w-full cursor-pointer" disabled={!trimmed || isPending}>
            {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DescriptionDialog({
  list,
  open,
  onOpenChange,
}: {
  list: PlaceList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply, isPending } = useListEditor(list.id);
  const [draft, setDraft] = useState(list.description ?? "");
  const trimmed = draft.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Description</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const next = trimmed || null;
            if (next === (list.description ?? null)) return onOpenChange(false);
            apply({ set: { description: next } }, { onDone: () => onOpenChange(false) });
          }}
        >
          <Textarea
            aria-label="List description"
            placeholder="What the list is for — e.g. solo dinners to try this month"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={4}
            autoFocus
          />
          <Button type="submit" className="w-full cursor-pointer" disabled={isPending}>
            {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  list,
  open,
  onOpenChange,
}: {
  list: PlaceList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deleteList = useDeleteList();
  const count = list.place_count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{list.name}”?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The list and its notes are removed for good.
          {count > 0 && ` Its ${count} place${count === 1 ? "" : "s"} stay saved.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            Keep list
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="cursor-pointer"
            disabled={deleteList.isPending}
            // mutateAsync, not mutate's callbacks: the delete empties the
            // cached list, the page switches to "not found" and unmounts this
            // dialog — callbacks passed to mutate() would never run.
            onClick={async () => {
              try {
                await deleteList.mutateAsync(list.id);
              } catch (err) {
                return toast.error(err instanceof Error ? err.message : "Failed to delete the list");
              }
              toast.success("List deleted");
              router.replace(LISTS_HOME);
            }}
          >
            {deleteList.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Delete list
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
