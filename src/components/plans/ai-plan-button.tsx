"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAiPlan } from "@/lib/hooks/use-plans";
import type { Plan } from "@/lib/types";

/** The AI Plan entry — shown only when AI features are enabled and
 *  available, like every other AI surface. */
export function AiPlanButton({ plan }: { plan: Plan }) {
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
        // The button just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!aiSettings?.enabled || !aiSettings.available) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer border-emerald-200 text-xs text-emerald-700 dark:border-emerald-900 dark:text-emerald-400"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="mr-1 h-3.5 w-3.5" />
        AI Plan
      </Button>
      {open && <AiPlanDialog plan={plan} open={open} onOpenChange={setOpen} />}
    </>
  );
}

function AiPlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const generate = useAiPlan(plan.id);
  const days = useMemo(() => plan.days ?? [], [plan.days]);
  const placeCount = useMemo(
    () => new Set(days.flatMap((d) => (d.stops ?? []).flatMap((s) => (s.place_id ? [s.place_id] : [])))).size,
    [days]
  );
  const [includePool, setIncludePool] = useState(placeCount === 0);

  // Prefill with the most common city among the places already in the plan.
  const defaultCity = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of days) {
      for (const stop of d.stops ?? []) {
        const c = stop.place?.city;
        if (c) counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [days]);
  const [city, setCity] = useState(defaultCity);

  function run() {
    generate.mutate(
      { include_pool: includePool, city: includePool && city.trim() ? city.trim() : undefined },
      {
        onSuccess: (data) => {
          toast.success(
            `Planned ${data.days.length} day${data.days.length === 1 ? "" : "s"} · ${data.placed} places${
              data.left_out ? ` (${data.left_out} left out)` : ""
            }`
          );
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const tooFew = !includePool && placeCount < 2;

  return (
    // While the model works the dialog stays: the result rewrites the days,
    // and an edit made in between would be planned over.
    <Dialog open={open} onOpenChange={(next) => (generate.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            AI Plan
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Distributes places across your {days.length} day{days.length === 1 ? "" : "s"} by geography,
            theme and opening days — with a part of the day for each stop and a short story per day.
            Rewrites the day assignments: a place it leaves out is removed from the plan. Costs and
            exact times are kept. Uses 1 AI plan unit (50/month).
          </p>
          {!plan.start_date && (
            <p className="text-xs text-muted-foreground">
              This plan has no date yet, so opening days can&apos;t be taken into account.
            </p>
          )}

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={includePool}
              onChange={(e) => setIncludePool(e.target.checked)}
              className="mt-0.5 accent-emerald-600"
            />
            <span className="text-xs">
              Also pull from my <b>want-to-go</b> places
              <span className="mt-0.5 block text-muted-foreground">
                {includePool
                  ? "Places already in the plan + your want-to-go places in the city below."
                  : "Only the places already in this plan."}
              </span>
            </span>
          </label>

          {includePool && (
            <Input
              placeholder="City (e.g. Amsterdam)"
              aria-label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-10 text-sm"
            />
          )}

          {tooFew && (
            <p className="text-xs text-muted-foreground">
              This plan has fewer than 2 places — enable the want-to-go pool or add places first.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={generate.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={run}
              disabled={generate.isPending || (includePool && !city.trim()) || tooFew}
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Planning…
                </>
              ) : (
                "Generate plan"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
