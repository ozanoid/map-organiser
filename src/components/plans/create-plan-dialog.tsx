"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLists } from "@/lib/hooks/use-lists";
import { useCreatePlan } from "@/lib/hooks/use-plans";
import { formatDateRange, planEndDate } from "@/lib/plans/dates";
import { MAX_PLAN_DAYS } from "@/lib/plans/schema";

/**
 * New plan: a name, how many days, and — optionally — when. A plan without
 * a date keeps its days and is scheduled later. Starting from a list puts
 * the list's places on day 1, ready for Auto Plan.
 */
export function CreatePlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data: lists = [] } = useLists();
  const createPlan = useCreatePlan();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [dayCount, setDayCount] = useState(1);
  const [source, setSource] = useState<"empty" | "list">("empty");
  const [listId, setListId] = useState("");

  const end = start ? planEndDate(start, dayCount) : null;
  const canSubmit = !!name.trim() && !createPlan.isPending && (source === "empty" || !!listId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    createPlan.mutate(
      {
        name: name.trim(),
        start_date: start || null,
        day_count: dayCount,
        list_id: source === "list" ? listId : undefined,
      },
      {
        onSuccess: ({ id }) => {
          toast.success("Plan created");
          onOpenChange(false);
          router.push(`/plans/${id}`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const stepper =
    "inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-30";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input
            placeholder="Name (e.g. Saturday in Shoreditch, Barcelona in March)"
            aria-label="Plan name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-muted-foreground">
              {dayCount > 1 ? "First day" : "Date"} <span className="font-normal">(optional)</span>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-10" />
            </label>
            <div>
              <span id="plan-days-label" className="block text-xs font-medium text-muted-foreground">
                Days
              </span>
              <div className="mt-1 flex items-center gap-2" role="group" aria-labelledby="plan-days-label">
                <button
                  type="button"
                  className={stepper}
                  aria-label="One day fewer"
                  disabled={dayCount <= 1}
                  onClick={() => setDayCount((n) => Math.max(1, n - 1))}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-6 text-center text-sm font-medium" aria-live="polite">
                  {dayCount}
                </span>
                <button
                  type="button"
                  className={stepper}
                  aria-label="One day more"
                  disabled={dayCount >= MAX_PLAN_DAYS}
                  onClick={() => setDayCount((n) => Math.min(MAX_PLAN_DAYS, n + 1))}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
            {start ? formatDateRange(start, end) : "No date yet — you can set it later."}
          </p>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Start with</legend>
            <div className="space-y-1">
              <label className="flex min-h-9 cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="plan-source"
                  checked={source === "empty"}
                  onChange={() => setSource("empty")}
                  className="accent-emerald-600"
                />
                <span className="text-sm">An empty plan</span>
              </label>
              <label className="flex min-h-9 cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="plan-source"
                  checked={source === "list"}
                  onChange={() => setSource("list")}
                  className="accent-emerald-600"
                />
                <span className="text-sm">The places of a list</span>
              </label>
            </div>

            {source === "list" && (
              <div className="mt-2">
                <Select
                  items={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.place_count || 0} places)` }))}
                  value={listId}
                  onValueChange={(v) => setListId(v as string)}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Select a list..." />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.place_count || 0} places)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dayCount > 1 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    They start on day 1 — “Auto Plan” spreads them over the days.
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <Button type="submit" className="w-full cursor-pointer" disabled={!canSubmit}>
            {createPlan.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Create plan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
