import "server-only";
import { z } from "zod";
import { clip, ToolInputError, type AssistantContext } from "@/lib/assistant/library";
import { defineTool } from "@/lib/assistant/tools/types";
import { trackUsage } from "@/lib/google/track-usage";
import { addDays, planPhase, todayAt, weekdayName, type PlanPhase } from "@/lib/plans/dates";
import {
  dayRoute,
  getPlan,
  listPlans,
  planOutlines,
  routedStops,
  RouteUnavailableError,
  type PlanOutline,
  type StopOutline,
} from "@/lib/plans/read";
import { isOpenOnDate, type Timetable } from "@/lib/places/open-now";
import { log } from "@/lib/telemetry/logger";
import { fold } from "@/lib/text/fold";
import type { Plan, PlanDay, PlanRoute, PlanStop } from "@/lib/types";

/**
 * Plans as the model sees them — get_plans here, and the plan that
 * create_plan and update_plan return after a write.
 *
 * Field names follow the write tools' input (start_time, day_part,
 * cost_estimate, place_id, day, day_id), so what the model reads it can
 * write back.
 *
 * A plan is upcoming until its last day is over where it takes place: "today"
 * is the date in the time zone of the plan's last stop at a located place
 * (UTC when it has none) — not the server's date, which is already tomorrow
 * during a New York evening. A zone moves the date at most a day from UTC's,
 * so only plans whose last day is within a day of today (UTC) need their
 * zone looked up; the rest are judged by the UTC date with the same result.
 */

const PHASES = ["upcoming", "unscheduled", "past", "cancelled"] as const satisfies readonly PlanPhase[];
const PHASE_ORDER: Record<PlanPhase, number> = { upcoming: 0, unscheduled: 1, past: 2, cancelled: 3 };
/** Stops named in a plan list's preview; get_plans with plan_id has them all. */
const PREVIEW_STOPS = 8;

/** The plan's page in the app. */
export function planUrl(ctx: AssistantContext, planId: string): string {
  return `${ctx.appUrl}/plans/${planId}`;
}

/** Where the plan sits in time, judged by today's date where it takes place. */
const phaseOf = (plan: Plan, outline: PlanOutline | undefined) => planPhase(plan, todayAt(outline?.timeZone));

const stopName = (s: Pick<PlanStop, "place" | "title">) => s.place?.name ?? s.title ?? "Stop";

/** About 1 m — enough to tell which stops are close together. */
const coord = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * A stop for the model. `location` lets it keep close places on one day;
 * `open_that_day` (a dated plan, a place with opening hours) whether the
 * place opens on the day's date at all — the two things AI Plan used to
 * weigh (v1.53.0).
 */
function stopForModel(s: PlanStop, date: string | null, opening: ReadonlyMap<string, Timetable | null>) {
  const timetable = s.place_id ? opening.get(s.place_id) : undefined;
  const open = date && timetable ? isOpenOnDate(timetable, date) : null;
  return {
    stop_id: s.id,
    place_id: s.place_id ?? undefined,
    place: s.place
      ? {
          name: s.place.name,
          category: s.place.category?.name,
          area: s.place.city ?? undefined,
          location: s.place.location ? { lat: coord(s.place.location.lat), lng: coord(s.place.location.lng) } : undefined,
          maps_url: s.place.google_data.url ?? undefined,
        }
      : undefined,
    open_that_day: open ?? undefined,
    title: s.title ?? undefined,
    start_time: s.start_time ?? undefined,
    day_part: s.day_part ?? undefined,
    notes: s.notes ?? undefined,
    cost_estimate: s.cost_estimate ?? undefined,
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
  phase: PlanPhase,
  routes?: Map<string, RouteForModel>,
  opening: ReadonlyMap<string, Timetable | null> = new Map()
) {
  return {
    plan_id: plan.id,
    name: plan.name,
    phase,
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
      stops: (d.stops ?? []).map((s) => stopForModel(s, d.date ?? null, opening)),
    })),
  };
}

function preview(stops: StopOutline[], multiDay: boolean): string[] {
  return stops.slice(0, PREVIEW_STOPS).map((s) => {
    const when = s.start_time ?? (s.day_part ? `(${s.day_part})` : "");
    return [multiDay ? `Day ${s.day_number}:` : "", s.name, when, s.status === "planned" ? "" : `[${s.status}]`]
      .filter(Boolean)
      .join(" ");
  });
}

/** A plan in a list: dates, counts, the first stops by name, the link. */
function planSummary(ctx: AssistantContext, plan: Plan, phase: PlanPhase, stops: StopOutline[]) {
  const multiDay = (plan.day_count ?? 1) > 1;
  const count = (status: StopOutline["status"]) => stops.filter((s) => s.status === status).length || undefined;
  return {
    plan_id: plan.id,
    name: plan.name,
    phase,
    start_date: plan.start_date ?? undefined,
    weekday: plan.start_date ? weekdayName(plan.start_date) : undefined,
    end_date: multiDay ? (plan.end_date ?? undefined) : undefined,
    days: plan.day_count,
    stops: plan.stop_count,
    done: count("done"),
    skipped: count("skipped"),
    party_size: plan.party_size > 1 ? plan.party_size : undefined,
    notes: clip(plan.notes, 200),
    stops_preview: stops.length ? preview(stops, multiDay) : undefined,
    url: planUrl(ctx, plan.id),
  };
}

/** Upcoming soonest first; then the plans without dates, newest first; then
 *  past and cancelled ones, most recent first. */
function byPhaseThenDate(phases: Map<string, PlanPhase>) {
  return (a: Plan, b: Plan) => {
    const pa = phases.get(a.id)!;
    const pb = phases.get(b.id)!;
    if (pa !== pb) return PHASE_ORDER[pa] - PHASE_ORDER[pb];
    if (pa === "upcoming") return a.start_date!.localeCompare(b.start_date!);
    return (b.start_date ?? "").localeCompare(a.start_date ?? "") || b.created_at.localeCompare(a.created_at);
  };
}

/** The opening hours of a dated plan's places — none for a plan without
 *  dates, whose days have no weekday. */
async function openingOf(ctx: AssistantContext, plan: Plan): Promise<Map<string, Timetable | null>> {
  const ids = [...new Set((plan.days ?? []).flatMap((d) => (d.stops ?? []).flatMap((s) => (s.place_id ? [s.place_id] : []))))];
  if (!plan.start_date || ids.length === 0) return new Map();
  const { data, error } = await ctx.supabase
    .from("places")
    .select("id,timetable:google_data->work_timetable")
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.id as string, (r.timetable as Timetable | null) ?? null]));
}

/** One plan in full, with its phase where it takes place. */
async function planInFull(ctx: AssistantContext, planId: string, withRoutes = false) {
  const [plan, outlines] = await Promise.all([getPlan(ctx, planId), planOutlines(ctx, [planId])]);
  if (!plan) return null;
  const [routes, opening] = await Promise.all([withRoutes ? routesOf(ctx, plan) : undefined, openingOf(ctx, plan)]);
  return planForModel(ctx, plan, phaseOf(plan, outlines.get(planId)), routes, opening);
}

/**
 * The plan after a write. The write has landed by now, so a failed read-back
 * is reported as a note, not as an error — a retry would save it twice.
 */
export async function savedPlan(ctx: AssistantContext, planId: string) {
  try {
    const plan = await planInFull(ctx, planId);
    if (plan) return { plan };
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
    "The user's plans: outings and trips saved in Map Organiser, each with days and stops. Without plan_id it lists plans with their dates, the first stops and a link — by default the ones still ahead and those without dates yet; a plan is ahead until its last day is over where it takes place. With plan_id it returns one plan in full: every day with its date and weekday, and every stop in order with its saved place (and where it is, location) or text, start_time or day_part, notes, cost per person, status (planned, done, skipped), whether its place opens on that day's date (open_that_day, dated plans) and the visit logged for it. with_routes adds travel time and distance between each day's stops. Answers 'what are my plans', 'what's on Saturday', 'show me the Barcelona plan'.",
  inputSchema: z.object({
    plan_id: z.uuid().optional().describe("One plan in full"),
    phase: z
      .enum(["upcoming", "unscheduled", "past", "cancelled", "all"])
      .optional()
      .describe(
        "Which plans to list. Default: upcoming and unscheduled; with name, every phase; with from/to, plans that aren't cancelled"
      ),
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
    if (plan_id) {
      const plan = await planInFull(ctx, plan_id, with_routes);
      if (!plan) throw new ToolInputError("No plan with that id. Take plan_id from a get_plans list.");
      return { plan };
    }

    const all = await listPlans(ctx);
    const utcToday = todayAt(null);
    const nearToday = all.filter(
      (p) =>
        p.status === "planned" &&
        p.end_date !== null &&
        p.end_date >= addDays(utcToday, -1) &&
        p.end_date <= addDays(utcToday, 1)
    );
    const zoned = await planOutlines(
      ctx,
      nearToday.map((p) => p.id)
    );
    const phases = new Map(all.map((p) => [p.id, phaseOf(p, zoned.get(p.id))]));
    const counts: Record<PlanPhase, number> = { upcoming: 0, unscheduled: 0, past: 0, cancelled: 0 };
    for (const p of all) counts[phases.get(p.id)!]++;

    const ranged = Boolean(from || to);
    const wanted = new Set<PlanPhase>(
      phase === "all" || (!phase && name)
        ? PHASES
        : phase
          ? [phase]
          : ranged
            ? ["upcoming", "past"]
            : ["upcoming", "unscheduled"]
    );
    const needle = name ? fold(name) : null;
    const matches = all
      .filter((p) => wanted.has(phases.get(p.id)!))
      .filter(
        (p) =>
          !ranged ||
          (p.start_date !== null && (!to || p.start_date <= to) && (!from || (p.end_date ?? p.start_date) >= from))
      )
      .filter((p) => !needle || fold(p.name).includes(needle))
      .sort(byPhaseThenDate(phases));
    const shown = matches.slice(0, limit);
    // Stop names for the plans shown — read only for those.
    const named = await planOutlines(
      ctx,
      shown.filter((p) => !zoned.has(p.id)).map((p) => p.id)
    );
    const stopsOf = (id: string) => (zoned.get(id) ?? named.get(id))?.stops ?? [];

    return {
      plans: shown.map((p) => planSummary(ctx, p, phases.get(p.id)!, stopsOf(p.id))),
      more: matches.length > shown.length ? matches.length - shown.length : undefined,
      all_plans: counts,
      note: shown.length === 0 ? "No plans match. all_plans counts every plan of the user by phase." : undefined,
    };
  },
});
