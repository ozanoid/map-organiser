"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarDays, Loader2, MoreHorizontal, Pencil, RotateCcw, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDeletePlan } from "@/lib/hooks/use-plans";
import { useCreateSharedLink } from "@/lib/hooks/use-shared-links";
import { formatDayDate, planEndDate } from "@/lib/plans/dates";
import type { Plan } from "@/lib/types";
import { ICON_BUTTON, UNDO_TOAST_MS, usePlanEditor } from "./use-plan-editor";

export const PLANS_HOME = "/lists?tab=plans";

/** The plan's own actions: share, dates, rename, cancel / restore, delete. */
export function PlanMenu({ plan, onEditDates }: { plan: Plan; onEditDates: () => void }) {
  const { apply } = usePlanEditor(plan.id);
  const createSharedLink = useCreateSharedLink();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cancelled = plan.status === "cancelled";

  function share() {
    createSharedLink.mutate(
      { resource_type: "plan", resource_id: plan.id },
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

  function setStatus(status: "planned" | "cancelled") {
    apply(
      { set: { status } },
      {
        onDone: () =>
          status === "cancelled"
            ? toast("Plan cancelled", {
                action: { label: "Undo", onClick: () => setStatus("planned") },
                duration: UNDO_TOAST_MS,
              })
            : toast.success("Plan restored"),
      }
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={ICON_BUTTON} aria-label="Plan actions">
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
          {!cancelled && (
            <>
              <DropdownMenuItem className="cursor-pointer py-2" onClick={onEditDates}>
                <CalendarDays />
                {plan.start_date ? "Change dates" : "Set dates"}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer py-2" onClick={() => setRenameOpen(true)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {cancelled ? (
            <DropdownMenuItem className="cursor-pointer py-2" onClick={() => setStatus("planned")}>
              <RotateCcw />
              Restore plan
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="cursor-pointer py-2" onClick={() => setStatus("cancelled")}>
              <Ban />
              Cancel plan
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" className="cursor-pointer py-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            Delete plan
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && <RenameDialog plan={plan} open={renameOpen} onOpenChange={setRenameOpen} />}
      {deleteOpen && <DeleteDialog plan={plan} open={deleteOpen} onOpenChange={setDeleteOpen} />}
    </>
  );
}

function RenameDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply, isPending } = usePlanEditor(plan.id);
  const [name, setName] = useState(plan.name);
  const trimmed = name.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename plan</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed || trimmed === plan.name) return onOpenChange(false);
            apply({ set: { name: trimmed } }, { onDone: () => onOpenChange(false) });
          }}
        >
          <Input
            aria-label="Plan name"
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

function DeleteDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deletePlan = useDeletePlan();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{plan.name}”?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The plan, its days and its stops are removed for good. Your saved places stay.
          {plan.status !== "cancelled" && " To keep it as history, cancel the plan instead."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>
            Keep plan
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="cursor-pointer"
            disabled={deletePlan.isPending}
            onClick={() =>
              deletePlan.mutate(plan.id, {
                onSuccess: () => {
                  toast.success("Plan deleted");
                  router.replace(PLANS_HOME);
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            {deletePlan.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Delete plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Sets, moves or removes the plan's dates. Only the start is stored — the
 *  days follow it, so moving a plan moves every day. */
export function PlanDatesDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply, isPending } = usePlanEditor(plan.id);
  const [start, setStart] = useState(plan.start_date ?? "");
  const dayCount = plan.day_count ?? plan.days?.length ?? 1;
  const end = start ? planEndDate(start, dayCount) : null;

  function save(start_date: string | null) {
    if (start_date === plan.start_date) return onOpenChange(false);
    apply(
      { set: { start_date } },
      {
        onDone: () => {
          toast.success(start_date ? "Dates updated" : "Dates removed");
          onOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Plan dates</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (start) save(start);
          }}
        >
          <label className="block text-xs font-medium text-muted-foreground">
            {dayCount > 1 ? "First day" : "Date"}
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 h-10"
              autoFocus
            />
          </label>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {!start
              ? "Without a date the plan keeps its days and waits to be scheduled."
              : dayCount > 1 && end
                ? `${dayCount} days — ${formatDayDate(start)} to ${formatDayDate(end)}.`
                : formatDayDate(start)}
          </p>
          <div className="flex gap-2">
            {plan.start_date && (
              <Button
                type="button"
                variant="outline"
                className="flex-1 cursor-pointer"
                disabled={isPending}
                onClick={() => save(null)}
              >
                Remove dates
              </Button>
            )}
            <Button type="submit" className="flex-1 cursor-pointer" disabled={!start || isPending}>
              {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
