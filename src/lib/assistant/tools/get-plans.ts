import "server-only";
import { z } from "zod";
import { clip, ToolInputError, type AssistantContext } from "@/lib/assistant/library";
import { defineTool } from "@/lib/assistant/tools/types";
import { trackUsage } from "@/lib/google/track-usage";
import { planPhase, todayIso, weekdayName, type PlanPhase } from "@/lib/plans/dates";
import {
  dayRoute,
  getPlan,
  listPlans,
  planOutlines,
  routedStops,
  RouteUnavailableError,
  type StopOutline,
} from "@/lib/plans/read";
import { log } from "@/lib/telemetry/logger";
import { fold } from "@/lib/text/fold";
import type { Plan, PlanDay, PlanRoute, PlanStop } from "@/lib/types";

/**
 * Plans as the model sees them — get_plans here, and the plan that
 * create_plan and update_plan return after a write.
 *
 * "Today" is the server's date (UTC). It decides whether a plan is upcoming
 * or past and is returned with every answer, so the model reads dates
 * against the same day.
 */

const PHASES = ["upcoming", "unscheduled", "past", "cancelled"] as const satisfies readonly PlanPhase[];
const PHASE_ORDER: Record<PlanPhase, number> = { upcoming: 0, unscheduled: 1, past: 2, cancelled: 3 };
/** Stops named in a plan list's preview; get_plans with plan_id has them all. */
const PREVIEW_STOPS = 8;

/** The plan's page in the app. */
export function planUrl(ctx: AssistantContext, planId: string): string {
  return new URL(`/plans/${planId}`, ctx.appUrl).toString();
}

const stopName = (s: Pick<PlanStop, "place" | "title">) => s.place?.name ?? s.title ?? "Stop";

function stopForModel(s: PlanStop) {
  return {
    stop_id: s.id,
    place: s.place
      ? {
          place_id: s.place.id,
          name: s.place.name,
          category: s.place.category?.name,
          area: s.place.city ?? undefined,
          maps_url: s.place.google_data.url ?? undefined,
        }
      : undefined,
    title: s.title ?? undefined,
    time: s.start_time ?? undefined,
    day_part: s.day_part ?? undefined,
    notes: s.notes ?? undefined,
    cost_per_person: s.cost_estimate ?? undefined,
    currency: s.cost_estimate != null ? (s.currency ?? undefined) : undefined,
    status: s.status,
    visit: s.visit
      ? {
          visit_id: s.visit.id,
          date: s.visit.visited_on,
          rating: s.visit.rating ?? undefined,
          notes: s.visit.notes ?? undefined,
        }
      : undefined,
  };
}

type RouteForModel =
  | {
      travel: PlanDay["routing_profile"];
      km: number;
      minutes: number;
      legs: { from: string; to: string; km: number; minutes: number }[];
    }
  | "unavailable";

const roundKm = (km: number) => Math.round(km * 10) / 10;

function routeForModel(day: PlanDay, route: PlanRoute): RouteForModel {
  const names = new Map((day.stops ?? []).map((s) => [s.id, stopName(s)]));
  return {
    travel: day.routing_profile,
    km: roundKm(route.distance_km),
    minutes: Math.round(route.duration_min),
    legs: route.legs.map((leg) => ({
      from: names.get(leg.from_stop_id) ?? "?",
      to: names.get(leg.to_stop_id) ?? "?",
      km: roundKm(leg.distance_km),
      minutes: Math.round(leg.duration_min),
    })),
  };
}

/** Each day's route — one Mapbox Directions request per day with two or more
 *  stops at located places. A day whose route can't be computed says so. */
async function routesOf(ctx: AssistantContext, plan: Plan): Promise<Map<string, RouteForModel>> {
  let requests = 0;
  const routes = new Map<string, RouteForModel>();
  const settled = await Promise.allSettled(
    (plan.days ?? []).map(async (day) => {
      if (routedStops(day).length < 2) return;
      try {
        const route = await dayRoute(day, () => {
          requests++;
        });
        if (route) routes.set(day.id, routeForModel(day, route));
      } catch (e) {
        if (!(e instanceof RouteUnavailableError)) throw e;
        routes.set(day.id, "unavailable");
      }
    })
  );
  // Recorded even when another day failed: those requests were made.
  for (let i = 0; i < requests; i++) await trackUsage(ctx.userId, "mapbox_directions", ctx.supabase);
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) throw failed.reason;
  return routes;
}

/** One plan in full: days with dates, stops in order, visits; routes if asked. */
export function planForModel(
  ctx: AssistantContext,
  plan: Plan,
  today: string,
  routes?: Map<string, RouteForModel>
) {
  return {
    plan_id: plan.id,
    name: plan.name,
    phase: planPhase(plan, today),
    start_date: plan.start_date ?? undefined,
    end_date: plan.end_date ?? undefined,
    party_size: plan.party_size,
    notes: plan.notes ?? undefined,
    url: planUrl(ctx, plan.id),
    days: (plan.days ?? []).map((d) => ({
      day: d.day_number,
      day_id: d.id,
      date: d.date ?? undefined,
      weekday: d.date ? weekdayName(d.date) : undefined,
      notes: d.notes ?? undefined,
      route: routes?.get(d.id),
      stops: (d.stops ?? []).map(stopForModel),
    })),
  };
}

function preview(outline: StopOutline[], multiDay: boolean): string[] {
  return outline.slice(0, PREVIEW_STOPS).map((s) => {
    const when = s.start_time ?? (s.day_part ? `(${s.day_part})` : "");
    return [multiDay ? `Day ${s.day_number}:` : "", s.name, when, s.status === "planned" ? "" : `[${s.status}]`]
      .filter(Boolean)
      .join(" ");
  });
}

/** A plan in a list: dates, counts, the first stops by name, the link. */
function planSummary(ctx: AssistantContext, plan: Plan, today: string, outline: StopOutline[]) {
  const multiDay = (plan.day_count ?? 1) > 1;
  const count = (status: StopOutline["status"]) => outline.filter((s) => s.status === status).length || undefined;
  return {
    plan_id: plan.id,
    name: plan.name,
    phase: planPhase(plan, today),
    start_date: plan.start_date ?? undefined,
    weekday: plan.start_date ? weekdayName(plan.start_date) : undefined,
    end_date: multiDay ? (plan.end_date ?? undefined) : undefined,
    days: plan.day_count,
    stops: plan.stop_count,
    done: count("done"),
    skipped: count("skipped"),
    party_size: plan.party_size > 1 ? plan.party_size : undefined,
    notes: clip(plan.notes, 200),
    stops_preview: outline.length ? preview(outline, multiDay) : undefined,
    url: planUrl(ctx, plan.id),
  };
}

/** Upcoming soonest first; then the plans without dates, newest first; then
 *  past and cancelled ones, most recent first. */
function byPhaseThenDate(today: string) {
  return (a: Plan, b: Plan) => {
    const pa = planPhase(a, today);
    const pb = planPhase(b, today);
    if (pa !== pb) return PHASE_ORDER[pa] - PHASE_ORDER[pb];
    if (pa === "upcoming") return a.start_date!.localeCompare(b.start_date!);
    return (b.start_date ?? "").localeCompare(a.start_date ?? "") || b.created_at.localeCompare(a.created_at);
  };
}

/**
 * The plan after a write. The write has landed by now, so a failed read-back
 * is reported as a note, not as an error — a retry would save it twice.
 */
export async function savedPlan(ctx: AssistantContext, planId: string) {
  try {
    const plan = await getPlan(ctx, planId);
    if (plan) return { plan: planForModel(ctx, plan, todayIso()) };
  } catch (e) {
    log.warn("assistant.plan_read_back_failed", {
      planId,
      userId: ctx.userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return {
    plan_id: planId,
    url: planUrl(ctx, planId),
    note: "Saved, but the plan couldn't be read back just now — get_plans shows it.",
  };
}

export const getPlans = defineTool({
  name: "get_plans",
  title: "Plans",
  description:
    "The user's plans: outings and trips saved in Map Organiser, each with days and stops. Without plan_id it lists plans with their dates, the first stops and a link — by default the ones still ahead and those without dates yet. With plan_id it returns one plan in full: every day with its date and weekday, and every stop in order with its saved place or text, time or part of the day, notes, cost per person, status (planned, done, skipped) and the visit logged for it. with_routes adds travel time and distance between each day's stops. Answers 'what are my plans', 'what's on Saturday', 'show me the Barcelona plan'.",
  inputSchema: z.object({
    plan_id: z.uuid().optional().describe("One plan in full"),
    phase: z
      .enum(["upcoming", "unscheduled", "past", "cancelled", "all"])
      .optional()
      .describe("Which plans to list. Default: upcoming and unscheduled; with from/to, every plan with a day in that range"),
    from: z.iso.date().optional().describe("Plans with a day on or after this date, YYYY-MM-DD"),
    to: z.iso.date().optional().describe("Plans with a day on or before this date, YYYY-MM-DD"),
    name: z.string().trim().min(1).max(80).optional().describe("Part of the plan's name"),
    with_routes: z
      .boolean()
      .optional()
      .describe("With plan_id: travel time and distance between each day's stops"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, { plan_id, phase, from, to, name, with_routes, limit }) {
    const today = todayIso();

    if (plan_id) {
      const plan = await getPlan(ctx, plan_id);
      if (!plan) throw new ToolInputError("No plan with that id. Take plan_id from a get_plans list.");
      const routes = with_routes ? await routesOf(ctx, plan) : undefined;
      return { today, plan: planForModel(ctx, plan, today, routes) };
    }

    const all = await listPlans(ctx);
    const counts: Record<PlanPhase, number> = { upcoming: 0, unscheduled: 0, past: 0, cancelled: 0 };
    for (const p of all) counts[planPhase(p, today)]++;

    const ranged = Boolean(from || to);
    const wanted = new Set<PlanPhase>(
      phase === "all" ? PHASES : phase ? [phase] : ranged ? ["upcoming", "past"] : ["upcoming", "unscheduled"]
    );
    const needle = name ? fold(name) : null;
    const matches = all
      .filter((p) => wanted.has(planPhase(p, today)))
      .filter(
        (p) =>
          !ranged ||
          (p.start_date !== null && (!to || p.start_date <= to) && (!from || (p.end_date ?? p.start_date) >= from))
      )
      .filter((p) => !needle || fold(p.name).includes(needle))
      .sort(byPhaseThenDate(today));
    const shown = matches.slice(0, limit);
    const outlines = await planOutlines(
      ctx,
      shown.map((p) => p.id)
    );

    return {
      today,
      plans: shown.map((p) => planSummary(ctx, p, today, outlines.get(p.id) ?? [])),
      more: matches.length > shown.length ? matches.length - shown.length : undefined,
      all_plans: counts,
      note: shown.length === 0 ? "No plans match. all_plans counts every plan of the user by phase." : undefined,
    };
  },
});
