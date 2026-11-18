import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { classifyPostgrestError, InputError, NotFoundError } from "@/lib/db/errors";
import { autoPlan } from "@/lib/plans/auto-plan";
import { defaultCostEstimate } from "@/lib/plans/cost-defaults";
import { getPlan, routedStops, type PlanContext } from "@/lib/plans/read";
import { MAX_STOPS_PER_DAY, type PlanChanges, type PlanCreateInput, type PlanOp, type StopInput } from "@/lib/plans/schema";
import type { Plan } from "@/lib/types";

/**
 * Writing plans — shared by the API routes and the assistant tools.
 *
 * A write is one call to a Postgres function (create_plan,
 * apply_plan_changes), so it is one transaction: a plan is never half
 * created and a batch of edits applies completely or not at all. This module
 * adds what the database can't know: a default cost for a stop, and which
 * errors are the caller's to fix.
 */

/** The caller's input can't be applied; the message says why. */
export class PlanInputError extends InputError {}
/** The plan doesn't exist or isn't the caller's. */
export class PlanNotFoundError extends NotFoundError {
  constructor() {
    super("Plan not found");
  }
}

function fail(error: PostgrestError): never {
  const kind = classifyPostgrestError(error);
  if (kind.kind === "not_found") throw new PlanNotFoundError();
  if (kind.kind === "input") throw new PlanInputError(kind.message);
  throw new Error(error.message);
}

/**
 * Stops that name a place and say nothing about cost get the per-person
 * default for the place's price level (an explicit null stays empty). The
 * defaults are US dollars, so a stop in another currency gets none — "25"
 * from the dollar table must not be saved as 25 GBP. Places that aren't the
 * user's are left as they are — the database refuses them with a message.
 */
async function withDefaultCosts<T extends Pick<StopInput, "place_id" | "cost_estimate" | "currency">>(
  ctx: PlanContext,
  stops: T[]
): Promise<void> {
  const wantsDefault = (s: T) =>
    !!s.place_id && s.cost_estimate === undefined && (s.currency === undefined || s.currency === "USD");
  const ids = [...new Set(stops.filter(wantsDefault).map((s) => s.place_id!))];
  if (ids.length === 0) return;
  const { data, error } = await ctx.supabase
    .from("places")
    .select("id,price_level:google_data->price_level")
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const costs = new Map(
    ((data ?? []) as { id: string; price_level: number | null }[]).map((p) => [
      p.id,
      defaultCostEstimate({ price_level: p.price_level }),
    ])
  );
  for (const stop of stops) {
    if (wantsDefault(stop)) {
      const cost = costs.get(stop.place_id!);
      if (cost != null) stop.cost_estimate = cost;
    }
  }
}

/** Creates a plan with its days and stops; returns the new plan's id. */
export async function createPlan(
  ctx: PlanContext,
  input: PlanCreateInput,
  opts: { createdVia: "app" | "assistant" }
): Promise<string> {
  const days = (input.days ?? [{}]).map((d) => ({ ...d, stops: (d.stops ?? []).map((s) => ({ ...s })) }));
  await withDefaultCosts(ctx, days.flatMap((d) => d.stops));

  const { data, error } = await ctx.supabase.rpc("create_plan", {
    p_user_id: ctx.userId,
    p_plan: { ...input, days, created_via: opts.createdVia },
  });
  if (error) fail(error);
  return data as string;
}

/** Applies `set` and `ops` to a plan in one transaction. */
export async function changePlan(
  ctx: PlanContext,
  planId: string,
  changes: PlanChanges
): Promise<{ added_days: number[]; added_stops: string[] }> {
  const ops = (changes.ops ?? []).map((op) => ({ ...op }));
  await withDefaultCosts(
    ctx,
    ops.filter((op): op is Extract<PlanOp, { op: "add_stop" }> => op.op === "add_stop")
  );

  const { data, error } = await ctx.supabase.rpc("apply_plan_changes", {
    p_user_id: ctx.userId,
    p_plan_id: planId,
    p_changes: { set: changes.set ?? {}, ops },
  });
  if (error) fail(error);
  return data as { added_days: number[]; added_stops: string[] };
}

/** Deletes a plan with its days and stops. Visits that came from its stops
 *  stay (their link to the stop is cleared). */
export async function deletePlan(ctx: PlanContext, planId: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", ctx.userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new PlanNotFoundError();
}

/**
 * A list's places as stops, in list order — to start a plan from a list.
 * Only the user's own places: a list can hold a place id that isn't theirs
 * (a shared list whose copy failed half-way), and one such row must not
 * refuse the whole plan.
 */
export async function stopsFromList(ctx: PlanContext, listId: string): Promise<StopInput[]> {
  const { data, error } = await ctx.supabase
    .from("list_places")
    .select("place_id,sort_order,lists!inner(user_id),places!inner(user_id)")
    .eq("list_id", listId)
    .eq("lists.user_id", ctx.userId)
    .eq("places.user_id", ctx.userId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  const stops = ((data ?? []) as unknown as { place_id: string }[]).map((row) => ({ place_id: row.place_id }));
  if (stops.length > MAX_STOPS_PER_DAY) {
    throw new PlanInputError(
      `That list has ${stops.length} places — a day of a plan holds up to ${MAX_STOPS_PER_DAY}. Start from a smaller list.`
    );
  }
  return stops;
}

/**
 * The ops that put `stopIds` at the front of each day, in the given order.
 * Stops that are not named keep their day and follow the named ones.
 *
 * Works because days are handled in order and each move lands on the next
 * free position at the front: once a day is done its named stops are a
 * prefix, and later moves only take away stops behind that prefix.
 */
export function arrangeOps(arrangement: { day: number; stopIds: string[] }[]): PlanOp[] {
  return arrangement.flatMap(({ day, stopIds }) =>
    stopIds.map((stop_id, position): PlanOp => ({ op: "move_stop", stop_id, day, position }))
  );
}

/**
 * Spreads the plan's stops across its days by geography (k-means) and
 * orders each day by a daily rhythm. Only stops that are still planned and
 * have a located place are moved; the rest stay where they are.
 */
export async function autoPlanStops(ctx: PlanContext, planId: string): Promise<Plan> {
  const plan = await getPlan(ctx, planId);
  if (!plan) throw new PlanNotFoundError();
  const days = plan.days ?? [];

  const movable = days.flatMap((d) => routedStops(d).filter((s) => s.status === "planned"));
  if (movable.length === 0) {
    throw new PlanInputError("There are no places to distribute yet — add some first");
  }

  const planned = autoPlan(
    movable.map((s) => ({ stopId: s.id, location: s.place.location, category: s.place.category })),
    days.length
  );
  const ops = arrangeOps(planned.map((p) => ({ day: p.dayNumber, stopIds: p.places.map((x) => x.stopId) })));
  await changePlan(ctx, planId, { ops });

  const fresh = await getPlan(ctx, planId);
  if (!fresh) throw new PlanNotFoundError();
  return fresh;
}
