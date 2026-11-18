"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, Calendar, CalendarPlus, LayoutList, Loader2, Map as MapIcon, MapPin, Minus, Plus, Users, Wand2,
} from "lucide-react";
import { MapView } from "@/components/map/map-view";
import { AiPlanButton } from "@/components/plans/ai-plan-button";
import { PlanDayTimeline } from "@/components/plans/plan-day";
import { PlanDatesDialog, PlanMenu, PLANS_HOME } from "@/components/plans/plan-menu";
import { usePlanEditor } from "@/components/plans/use-plan-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/lib/hooks/use-categories";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import { useAutoPlan, usePlan, usePlanBusy, usePlanRoutes } from "@/lib/hooks/use-plans";
import { formatDateRange } from "@/lib/plans/dates";
import { dayColor } from "@/lib/plans/day-colors";
import { MAX_PLAN_DAYS } from "@/lib/plans/schema";
import { cn } from "@/lib/utils";
import type { Place, Plan, PlanDay } from "@/lib/types";

/**
 * The stops of these days that can be put on the map. MapView is typed for
 * full `Place` rows but reads only what a plan carries (id, name, address,
 * location, rating, visit status, category, Google link) — hence the cast.
 */
function mapPlaces(days: PlanDay[]): Place[] {
  const seen = new Set<string>();
  const places = days.flatMap((d) =>
    (d.stops ?? []).flatMap((s) => {
      if (!s.place?.location || seen.has(s.place.id)) return [];
      seen.add(s.place.id);
      return [s.place];
    })
  );
  return places as unknown as Place[];
}

function PlanDetail() {
  const planId = useParams().id as string;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: plan, isLoading, isError, refetch } = usePlan(planId);
  const { data: categories = [] } = useCategories();
  const { mapStyleUrl, markerStyle } = useMapStyle();
  const routes = usePlanRoutes(plan);
  const [datesOpen, setDatesOpen] = useState(false);
  const [pickedDay, setSelectedDay] = useState<number | null>(null);

  // The view lives in the URL so a refresh or a shared link keeps it.
  const view = searchParams.get("view") === "map" ? "map" : "timeline";
  function setView(next: "timeline" | "map") {
    router.replace(next === "map" ? `${pathname}?view=map` : pathname, { scroll: false });
  }

  const days = useMemo(() => plan?.days ?? [], [plan?.days]);
  // A day picked on the map may have been removed since.
  const selectedDay = days.some((d) => d.day_number === pickedDay) ? pickedDay : null;
  const shownDays = useMemo(
    () => (selectedDay === null ? days : days.filter((d) => d.day_number === selectedDay)),
    [days, selectedDay]
  );
  const places = useMemo(() => mapPlaces(shownDays), [shownDays]);
  const routeLines = useMemo(
    () =>
      shownDays.flatMap((d) => {
        const route = routes[d.id];
        return route?.geometry?.coordinates
          ? [{ id: `route-day-${d.day_number}`, color: dayColor(d.day_number), coordinates: route.geometry.coordinates }]
          : [];
      }),
    [shownDays, routes]
  );

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">The plan couldn&apos;t be loaded.</p>
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">This plan doesn&apos;t exist, or it was deleted.</p>
        <Link href={PLANS_HOME} className="text-sm text-emerald-600 hover:underline">
          Back to plans
        </Link>
      </div>
    );
  }

  const cancelled = plan.status === "cancelled";
  const stopCount = days.reduce((n, d) => n + (d.stops?.length ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b px-3 py-2 sm:px-4">
        <div className="flex items-center gap-1">
          <Link
            href={PLANS_HOME}
            aria-label="Back to plans"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className={cn("min-w-0 flex-1 truncate text-sm font-semibold", cancelled && "text-muted-foreground line-through")}>
            {plan.name}
          </h1>
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="View">
            <Button
              variant={view === "timeline" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 cursor-pointer"
              aria-label="Timeline"
              aria-pressed={view === "timeline"}
              onClick={() => setView("timeline")}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "map" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 cursor-pointer"
              aria-label="Map"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              <MapIcon className="h-4 w-4" />
            </Button>
          </div>
          <PlanMenu plan={plan} onEditDates={() => setDatesOpen(true)} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-1">
          <PlanDates plan={plan} readOnly={cancelled} onEdit={() => setDatesOpen(true)} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {days.length} day{days.length === 1 ? "" : "s"}
            <span aria-hidden>·</span>
            <MapPin className="h-3 w-3" />
            {stopCount} stop{stopCount === 1 ? "" : "s"}
          </span>
          <PlanBudget plan={plan} readOnly={cancelled} />
          {!cancelled && (
            <div className="ml-auto flex items-center gap-2">
              <AiPlanButton plan={plan} />
              {stopCount > 0 && <AutoPlanButton planId={plan.id} />}
            </div>
          )}
        </div>
      </header>

      {cancelled && <CancelledBanner planId={plan.id} />}

      {view === "map" ? (
        <div className="relative flex-1">
          <MapView
            places={places}
            categories={categories}
            mapStyle={mapStyleUrl}
            markerStyle={markerStyle}
            routeLines={routeLines}
            className="h-full w-full"
          />
          {days.length > 1 && (
            <div className="absolute bottom-20 left-4 right-4 z-10 flex flex-wrap justify-center gap-2 lg:bottom-4">
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                aria-pressed={selectedDay === null}
                className={cn(
                  "min-h-9 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium shadow-md transition-colors",
                  selectedDay === null
                    ? "bg-emerald-600 text-white"
                    : "bg-white/90 text-gray-700 dark:bg-gray-900/90 dark:text-gray-300"
                )}
              >
                All
              </button>
              {days.map((day) => {
                const active = selectedDay === day.day_number;
                const color = dayColor(day.day_number);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => setSelectedDay(active ? null : day.day_number)}
                    aria-pressed={active}
                    className="min-h-9 cursor-pointer rounded-full border-2 bg-white/90 px-3.5 py-1.5 text-xs font-medium shadow-md transition-colors dark:bg-gray-900/90"
                    style={{ borderColor: color, backgroundColor: active ? color : undefined, color: active ? "#fff" : color }}
                  >
                    Day {day.day_number}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-xl">
            {stopCount === 0 && !cancelled && (
              <p className="mb-4 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                Nothing planned yet. Use “Add stop” under a day to put a saved place or a note on it.
              </p>
            )}
            <Timeline plan={plan} days={days} routes={routes} readOnly={cancelled} />
          </div>
        </div>
      )}

      {datesOpen && <PlanDatesDialog plan={plan} open={datesOpen} onOpenChange={setDatesOpen} />}
    </div>
  );
}

function Timeline({
  plan,
  days,
  routes,
  readOnly,
}: {
  plan: Plan;
  days: PlanDay[];
  routes: ReturnType<typeof usePlanRoutes>;
  readOnly: boolean;
}) {
  const { apply } = usePlanEditor(plan.id);
  const busy = usePlanBusy(plan.id);
  return (
    <>
      {days.map((day) => (
        <PlanDayTimeline
          key={day.id}
          planId={plan.id}
          day={day}
          days={days}
          route={routes[day.id]}
          readOnly={readOnly}
          busy={busy}
        />
      ))}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer text-xs"
          disabled={busy || days.length >= MAX_PLAN_DAYS}
          title={days.length >= MAX_PLAN_DAYS ? `A plan holds up to ${MAX_PLAN_DAYS} days` : undefined}
          onClick={() => apply({ ops: [{ op: "add_day" }] })}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add day
        </Button>
      )}
    </>
  );
}

/** The plan's dates, or the invitation to set them. */
function PlanDates({ plan, readOnly, onEdit }: { plan: Plan; readOnly: boolean; onEdit: () => void }) {
  const label = plan.start_date ? formatDateRange(plan.start_date, plan.end_date) : "No date yet";
  if (readOnly) return <span className="text-xs text-muted-foreground">{label}</span>;
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        plan.start_date ? "font-medium" : "border-dashed text-muted-foreground"
      )}
    >
      <CalendarPlus className="h-3.5 w-3.5" />
      {plan.start_date ? label : "Set dates"}
    </button>
  );
}

/** Total = the stops' per-person costs × the party size. */
function PlanBudget({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { apply, isPending } = usePlanEditor(plan.id);
  const perPerson = (plan.days ?? []).reduce(
    (sum, d) => sum + (d.stops ?? []).reduce((s, stop) => s + (stop.cost_estimate ?? 0), 0),
    0
  );
  const size = plan.party_size;

  function step(delta: number) {
    const next = Math.min(50, Math.max(1, size + delta));
    if (next !== size) apply({ set: { party_size: next } });
  }

  const stepper =
    "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-30";

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {perPerson > 0 && (
        <span title={`$${Math.round(perPerson)} per person × ${size}`}>≈ ${Math.round(perPerson * size)}</span>
      )}
      {readOnly ? (
        <span className="inline-flex items-center gap-0.5">
          <Users className="h-3 w-3" />
          {size}
        </span>
      ) : (
        <span className="inline-flex items-center" role="group" aria-label="Party size">
          <button type="button" className={stepper} aria-label="One person fewer" disabled={size <= 1 || isPending} onClick={() => step(-1)}>
            <Minus className="h-3 w-3" />
          </button>
          <span className="inline-flex min-w-7 items-center justify-center gap-0.5" aria-live="polite">
            <Users className="h-3 w-3" />
            {size}
          </span>
          <button type="button" className={stepper} aria-label="One person more" disabled={size >= 50 || isPending} onClick={() => step(1)}>
            <Plus className="h-3 w-3" />
          </button>
        </span>
      )}
    </span>
  );
}

function AutoPlanButton({ planId }: { planId: string }) {
  const autoPlan = useAutoPlan(planId);
  return (
    <Button
      variant="outline"
      size="sm"
      className="cursor-pointer text-xs"
      disabled={autoPlan.isPending}
      onClick={() =>
        autoPlan.mutate(undefined, {
          onSuccess: () => toast.success("Places distributed across the days"),
          onError: (err) => toast.error(err.message),
        })
      }
    >
      {autoPlan.isPending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Wand2 className="mr-1 h-3.5 w-3.5" />
      )}
      Auto Plan
    </Button>
  );
}

function CancelledBanner({ planId }: { planId: string }) {
  const { apply, isPending } = usePlanEditor(planId);
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2">
      <p className="text-xs text-muted-foreground">This plan is cancelled. It is kept as it was.</p>
      <Button
        size="sm"
        variant="outline"
        className="cursor-pointer text-xs"
        disabled={isPending}
        onClick={() => apply({ set: { status: "planned" } }, { onDone: () => toast.success("Plan restored") })}
      >
        Restore
      </Button>
    </div>
  );
}

export default function PlanDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <PlanDetail />
    </Suspense>
  );
}
