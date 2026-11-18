import "server-only";
import type { UserContext } from "@/lib/db/context";
import { parsePostgisPoint } from "@/lib/geo";
import { dayDate, planEndDate } from "@/lib/plans/dates";
import { getRoute } from "@/lib/plans/directions";
import type {
  DayPart,
  Plan,
  PlanDay,
  PlanPlace,
  PlanRoute,
  PlanStatus,
  PlanStop,
  PlanStopVisit,
  RoutingProfile,
  StopStatus,
  VisitStatus,
} from "@/lib/types";

/**
 * Reading plans — shared by the API routes, the public share view and the
 * assistant tools.
 *
 * Every query is scoped twice: by the caller's Supabase client (a user
 * token, so RLS applies) and by an explicit `user_id` filter, which is what
 * protects the callers that use the service role.
 */

/** Who the call runs for — see src/lib/db/context.ts. */
export type PlanContext = UserContext;

// ── Row shapes (what PostgREST returns) ─────────────────────────────

interface PlaceRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  location: unknown;
  rating: number | null;
  visit_status: VisitStatus | null;
  google_place_id: string | null;
  category: { name: string; color: string; icon: string } | null;
  g_url: string | null;
  g_rating: number | null;
  g_count: number | null;
  g_price: number | string | null;
}

interface StopRow {
  id: string;
  day_id: string;
  sort_order: number;
  place_id: string | null;
  title: string | null;
  start_time: string | null;
  day_part: DayPart | null;
  notes: string | null;
  cost_estimate: number | null;
  currency: string | null;
  status: StopStatus;
  status_at: string | null;
  created_at: string;
  place: PlaceRow | null;
  /** visits.plan_stop_id is unique, so PostgREST embeds one object (or null);
   *  an array is accepted too. */
  visit: PlanStopVisit | PlanStopVisit[] | null;
}

interface DayRow {
  id: string;
  plan_id: string;
  day_number: number;
  notes: string | null;
  routing_profile: RoutingProfile | null;
  created_at: string;
  stops: StopRow[] | null;
}

interface PlanRow {
  id: string;
  user_id: string;
  list_id: string | null;
  name: string;
  start_date: string | null;
  status: PlanStatus;
  color: string | null;
  notes: string | null;
  party_size: number | null;
  created_via: "app" | "assistant";
  created_at: string;
  updated_at: string;
}

const PLAN_COLUMNS =
  "id,user_id,list_id,name,start_date,status,color,notes,party_size,created_via,created_at,updated_at";

const PLACE_SELECT = [
  "id,name,address,city,country,location,rating,visit_status,google_place_id",
  "category:categories(name,color,icon)",
  "g_url:google_data->>url,g_rating:google_data->rating",
  "g_count:google_data->user_ratings_total,g_price:google_data->price_level",
].join(",");

const STOP_SELECT = `id,day_id,sort_order,place_id,title,start_time,day_part,notes,cost_estimate,currency,status,status_at,created_at,place:places(${PLACE_SELECT}),visit:visits(id,visited_on,rating,notes)`;

const DAY_SELECT = `id,plan_id,day_number,notes,routing_profile,created_at,stops:plan_stops(${STOP_SELECT})`;

// ── Shaping ─────────────────────────────────────────────────────────

function shapePlace(row: PlaceRow | null): PlanPlace | null {
  if (!row) return null;
  const point = row.location ? parsePostgisPoint(row.location) : null;
  const price = Number(row.g_price);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    location: point && !(point.lat === 0 && point.lng === 0) ? point : null,
    rating: row.rating,
    visit_status: row.visit_status,
    google_place_id: row.google_place_id,
    category: row.category,
    google_data: {
      url: row.g_url,
      rating: row.g_rating,
      user_ratings_total: row.g_count,
      price_level: Number.isInteger(price) && price >= 1 && price <= 4 ? price : null,
    },
  };
}

function shapeStop(row: StopRow): PlanStop {
  return {
    id: row.id,
    day_id: row.day_id,
    sort_order: row.sort_order,
    place_id: row.place_id,
    title: row.title,
    // Postgres `time` comes back as "19:30:00".
    start_time: row.start_time ? row.start_time.slice(0, 5) : null,
    day_part: row.day_part,
    notes: row.notes,
    cost_estimate: row.cost_estimate == null ? null : Number(row.cost_estimate),
    currency: row.currency,
    status: row.status,
    status_at: row.status_at,
    created_at: row.created_at,
    place: shapePlace(row.place),
    visit: (Array.isArray(row.visit) ? row.visit[0] : row.visit) ?? null,
  };
}

function shapePlan(row: PlanRow, dayRows: DayRow[]): Plan {
  const days: PlanDay[] = [...dayRows]
    .sort((a, b) => a.day_number - b.day_number)
    .map((d) => ({
      id: d.id,
      plan_id: d.plan_id,
      day_number: d.day_number,
      date: dayDate(row.start_date, d.day_number),
      notes: d.notes,
      routing_profile: d.routing_profile ?? "walking",
      created_at: d.created_at,
      stops: [...(d.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(shapeStop),
    }));
  return {
    ...shapePlanRow(row, days.length),
    days,
    stop_count: days.reduce((n, d) => n + (d.stops?.length ?? 0), 0),
  };
}

function shapePlanRow(row: PlanRow, dayCount: number): Plan {
  return {
    id: row.id,
    user_id: row.user_id,
    list_id: row.list_id,
    name: row.name,
    start_date: row.start_date,
    end_date: planEndDate(row.start_date, dayCount),
    status: row.status,
    color: row.color ?? "#059669",
    notes: row.notes,
    party_size: row.party_size ?? 1,
    created_via: row.created_via,
    created_at: row.created_at,
    updated_at: row.updated_at,
    day_count: dayCount,
  };
}

// ── Queries ─────────────────────────────────────────────────────────

/** Every plan of the user, without days or stops — for lists. Newest start
 *  date first; plans without a date come first. */
export async function listPlans(ctx: PlanContext): Promise<Plan[]> {
  const { data, error } = await ctx.supabase
    .from("plans")
    .select(`${PLAN_COLUMNS},days:plan_days(id,stops:plan_stops(count))`)
    .eq("user_id", ctx.userId)
    .order("start_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  type Row = PlanRow & { days: { id: string; stops: { count: number }[] }[] | null };
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const days = row.days ?? [];
    return {
      ...shapePlanRow(row, days.length),
      stop_count: days.reduce((n, d) => n + (d.stops?.[0]?.count ?? 0), 0),
    };
  });
}

/** One plan with its days and stops, or null when it isn't the user's. */
export async function getPlan(ctx: PlanContext, planId: string): Promise<Plan | null> {
  const { data, error } = await ctx.supabase
    .from("plans")
    .select(`${PLAN_COLUMNS},days:plan_days(${DAY_SELECT})`)
    .eq("id", planId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as PlanRow & { days: DayRow[] | null };
  return shapePlan(row, row.days ?? []);
}

/** A stop as a list of plans names it. */
export interface StopOutline {
  day_number: number;
  /** The place's name, or the free-text stop's title. */
  name: string;
  start_time: string | null;
  day_part: DayPart | null;
  status: StopStatus;
}

/** A plan's stops by name, and the time zone its days are lived in. */
export interface PlanOutline {
  stops: StopOutline[];
  /** IANA zone of the plan's last stop at a located place ("Europe/London"),
   *  or null when no stop has one — the plan's last day ends there. */
  timeZone: string | null;
}

/** Each plan's stops in day and visiting order, names only, and its time
 *  zone — for a list of plans that says what is in each and whether it is
 *  over (the assistant's get_plans). Without `planIds`, every plan of the
 *  user. */
export async function planOutlines(ctx: PlanContext, planIds?: string[]): Promise<Map<string, PlanOutline>> {
  const out = new Map<string, PlanOutline>();
  if (planIds && planIds.length === 0) return out;
  let query = ctx.supabase
    .from("plans")
    .select(
      "id,days:plan_days(day_number,stops:plan_stops(sort_order,title,start_time,day_part,status,place:places(name,tz:google_data->>tz)))"
    )
    .eq("user_id", ctx.userId);
  if (planIds) query = query.in("id", planIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    days:
      | {
          day_number: number;
          stops:
            | {
                sort_order: number;
                title: string | null;
                start_time: string | null;
                day_part: DayPart | null;
                status: StopStatus;
                place: { name: string; tz: string | null } | null;
              }[]
            | null;
        }[]
      | null;
  };
  for (const plan of (data ?? []) as unknown as Row[]) {
    const stops: StopOutline[] = [];
    let timeZone: string | null = null;
    for (const day of [...(plan.days ?? [])].sort((a, b) => a.day_number - b.day_number)) {
      for (const s of [...(day.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
        stops.push({
          day_number: day.day_number,
          name: s.place?.name ?? s.title ?? "Stop",
          start_time: s.start_time ? s.start_time.slice(0, 5) : null,
          day_part: s.day_part,
          status: s.status,
        });
        if (s.place?.tz) timeZone = s.place.tz;
      }
    }
    out.set(plan.id, { stops, timeZone });
  }
  return out;
}

/** Names of the plans a set of places appears in — for the "this place is
 *  in a plan" warning before a delete. */
export async function plansUsingPlaces(
  ctx: PlanContext,
  placeIds: string[]
): Promise<{ plans: { id: string; name: string }[]; placeIds: string[] }> {
  if (placeIds.length === 0) return { plans: [], placeIds: [] };
  const { data, error } = await ctx.supabase
    .from("plan_stops")
    .select("place_id,plan_days!inner(plans!inner(id,name,user_id))")
    .in("place_id", placeIds)
    .eq("plan_days.plans.user_id", ctx.userId);
  if (error) throw new Error(error.message);

  type Row = { place_id: string; plan_days: { plans: { id: string; name: string } } };
  const plans = new Map<string, { id: string; name: string }>();
  const used = new Set<string>();
  for (const row of (data ?? []) as unknown as Row[]) {
    used.add(row.place_id);
    plans.set(row.plan_days.plans.id, { id: row.plan_days.plans.id, name: row.plan_days.plans.name });
  }
  return { plans: [...plans.values()], placeIds: [...used] };
}

// ── Routes ──────────────────────────────────────────────────────────

/** The stops a day's route runs through: those with a located place. */
export function routedStops(day: Pick<PlanDay, "stops">): (PlanStop & { place: PlanPlace & { location: { lat: number; lng: number } } })[] {
  return (day.stops ?? []).filter(
    (s): s is PlanStop & { place: PlanPlace & { location: { lat: number; lng: number } } } =>
      !!s.place?.location
  );
}

/** Mapbox gave no route (rate limit, network, no token, no path). Not the
 *  same as a day that has no route to ask for. */
export class RouteUnavailableError extends Error {
  constructor() {
    super("The route couldn't be computed right now");
  }
}

/**
 * A day's route (Mapbox Directions) through its located stops, or null when
 * the day has fewer than two. Throws RouteUnavailableError when Mapbox gives
 * none — a caller that caches must not remember that as "this day has no
 * route". `onDirectionsCall` runs once per route Mapbox returned, so the
 * caller can record the billable request.
 */
export async function dayRoute(
  day: Pick<PlanDay, "stops" | "routing_profile">,
  onDirectionsCall?: () => void
): Promise<PlanRoute | null> {
  const stops = routedStops(day);
  if (stops.length < 2) return null;
  const route = await getRoute(
    stops.map((s) => [s.place.location.lng, s.place.location.lat] as [number, number]),
    day.routing_profile
  );
  if (!route) throw new RouteUnavailableError();
  onDirectionsCall?.();
  return {
    distance_km: route.distance_km,
    duration_min: route.duration_min,
    geometry: route.geometry,
    legs: route.legs.map((leg, i) => ({
      from_stop_id: stops[i].id,
      to_stop_id: stops[i + 1]?.id ?? stops[i].id,
      distance_km: leg.distance_km,
      duration_min: leg.duration_min,
    })),
  };
}

/** The plan with a route on every day that has one (one Directions request
 *  per such day). A day whose route can't be computed is shown without one. */
export async function withRoutes(plan: Plan, onDirectionsCall?: () => void): Promise<Plan> {
  const days = await Promise.all(
    (plan.days ?? []).map(async (day) => ({
      ...day,
      route: await dayRoute(day, onDirectionsCall).catch((e) => {
        if (e instanceof RouteUnavailableError) return null;
        throw e;
      }),
    }))
  );
  return { ...plan, days };
}
