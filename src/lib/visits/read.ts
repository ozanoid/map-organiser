import "server-only";
import type { UserContext } from "@/lib/db/context";
import type { Visit } from "@/lib/types";

/**
 * Reading visits — shared by the API routes and the assistant tools. Every
 * query filters by `user_id` as well as running under the caller's client
 * (see src/lib/db/context.ts).
 */

interface VisitRow {
  id: string;
  place_id: string;
  visited_on: string;
  rating: number | null;
  notes: string | null;
  plan_stop_id: string | null;
  created_via: Visit["created_via"];
  created_at: string;
  updated_at: string;
  place: {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    g_url: string | null;
    category: { name: string; color: string } | null;
  } | null;
  stop: { day: { day_number: number; plan: { id: string; name: string } | null } | null } | null;
}

const VISIT_SELECT = [
  "id,place_id,visited_on,rating,notes,plan_stop_id,created_via,created_at,updated_at",
  "place:places(id,name,city,country,g_url:google_data->>url,category:categories(name,color))",
  "stop:plan_stops(day:plan_days(day_number,plan:plans(id,name)))",
].join(",");

function shape(row: VisitRow): Visit {
  const plan = row.stop?.day?.plan;
  return {
    id: row.id,
    place_id: row.place_id,
    visited_on: row.visited_on,
    rating: row.rating,
    notes: row.notes,
    plan_stop_id: row.plan_stop_id,
    created_via: row.created_via,
    created_at: row.created_at,
    updated_at: row.updated_at,
    place: row.place
      ? {
          id: row.place.id,
          name: row.place.name,
          city: row.place.city,
          country: row.place.country,
          maps_url: row.place.g_url,
          category: row.place.category,
        }
      : null,
    plan: plan && row.stop?.day ? { id: plan.id, name: plan.name, day_number: row.stop.day.day_number } : null,
  };
}

export interface VisitFilters {
  placeIds?: string[];
  /** Inclusive, "YYYY-MM-DD". */
  from?: string;
  to?: string;
  minRating?: number;
  limit?: number;
}

/** The user's visits, newest first. */
export async function listVisits(ctx: UserContext, f: VisitFilters = {}): Promise<Visit[]> {
  let query = ctx.supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("user_id", ctx.userId)
    .order("visited_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(f.limit ?? 50, 500));
  if (f.placeIds?.length) query = query.in("place_id", f.placeIds);
  if (f.from) query = query.gte("visited_on", f.from);
  if (f.to) query = query.lte("visited_on", f.to);
  if (f.minRating) query = query.gte("rating", f.minRating);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as VisitRow[]).map(shape);
}

/** One visit, or null when it isn't the user's. */
export async function getVisit(ctx: UserContext, id: string): Promise<Visit | null> {
  const { data, error } = await ctx.supabase
    .from("visits")
    .select(VISIT_SELECT)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data as unknown as VisitRow) : null;
}

/** How many visits each of these places has — for the delete warnings. */
export async function visitCounts(ctx: UserContext, placeIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (placeIds.length === 0) return counts;
  const { data, error } = await ctx.supabase
    .from("visits")
    .select("place_id")
    .eq("user_id", ctx.userId)
    .in("place_id", placeIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { place_id: string }[]) {
    counts.set(row.place_id, (counts.get(row.place_id) ?? 0) + 1);
  }
  return counts;
}
