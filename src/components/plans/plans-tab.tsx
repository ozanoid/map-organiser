"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, Compass, MapPin, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlans } from "@/lib/hooks/use-plans";
import { formatDateRange, planPhase, todayIso, type PlanPhase } from "@/lib/plans/dates";
import { cn } from "@/lib/utils";
import type { Plan } from "@/lib/types";
import { CreatePlanDialog } from "./create-plan-dialog";

const SECTIONS: { phase: PlanPhase; title: string }[] = [
  { phase: "upcoming", title: "Upcoming" },
  { phase: "unscheduled", title: "No date yet" },
  { phase: "past", title: "Past" },
  { phase: "cancelled", title: "Cancelled" },
];

/** The user's plans, grouped by where they sit in time. */
export function PlansTab() {
  const { data: plans = [], isLoading, isError, refetch } = usePlans();
  const [createOpen, setCreateOpen] = useState(false);

  const groups = useMemo(() => {
    const today = todayIso();
    const byPhase: Record<PlanPhase, Plan[]> = { upcoming: [], unscheduled: [], past: [], cancelled: [] };
    for (const plan of plans) byPhase[planPhase(plan, today)].push(plan);
    // The API sends newest start first; what is coming up reads soonest first.
    byPhase.upcoming.reverse();
    return byPhase;
  }, [plans]);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" className="cursor-pointer" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Plan
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">Your plans couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Compass className="mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500">No plans yet — an evening out or a trip, start one here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {SECTIONS.filter(({ phase }) => groups[phase].length > 0).map(({ phase, title }) => (
            <section key={phase} aria-label={title}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups[phase].map((plan) => (
                  <PlanCard key={plan.id} plan={plan} muted={phase === "cancelled" || phase === "past"} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {createOpen && <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}

function PlanCard({ plan, muted }: { plan: Plan; muted: boolean }) {
  const days = plan.day_count ?? 0;
  const stops = plan.stop_count ?? 0;
  return (
    <Link href={`/plans/${plan.id}`} prefetch={false} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              muted ? "bg-muted" : "bg-emerald-50 dark:bg-emerald-950"
            )}
          >
            <Compass className={cn("h-5 w-5", muted ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <span className={cn("truncate", plan.status === "cancelled" && "text-muted-foreground line-through")}>
                {plan.name}
              </span>
              {plan.status === "cancelled" && (
                <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                  Cancelled
                </Badge>
              )}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {days} day{days === 1 ? "" : "s"}
              <span aria-hidden className="mx-0.5">·</span>
              <MapPin className="h-3 w-3" />
              {stops} stop{stops === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {plan.start_date ? formatDateRange(plan.start_date, plan.end_date) : "No date yet"}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
