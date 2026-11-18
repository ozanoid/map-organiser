import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { UserContext } from "@/lib/db/context";
import { classifyPostgrestError, InputError, NotFoundError } from "@/lib/db/errors";
import { dayDate, todayAt } from "@/lib/plans/dates";
import type { VisitEditInput, VisitLogInput } from "@/lib/visits/schema";
import { getVisit } from "@/lib/visits/read";
import type { PlaceVisitSummary, Visit } from "@/lib/types";

/**
 * Writing visits — shared by the API routes and the assistant tools.
 *
 * Each write is one call to a Postgres function (log_visit, delete_visit),
 * so the visit, the place's summary (visit status, rating) and the plan stop
 * it fulfils change in one transaction. The rules live there; this module
 * adds the default date and the error mapping.
 */

export class VisitInputError extends InputError {}
export class VisitNotFoundError extends NotFoundError {
  constructor() {
    super("Visit not found");
  }
}

function fail(error: PostgrestError): never {
  const kind = classifyPostgrestError(error);
  if (kind.kind === "not_found") throw new VisitNotFoundError();
  if (kind.kind === "input") throw new VisitInputError(kind.message);
  throw new Error(error.message);
}

export interface VisitWriteResult {
  visit: Visit;
  /** false when the place already had a visit that day and it was updated. */
  created: boolean;
  place: PlaceVisitSummary;
}

/**
 * The date a visit gets when none is given: the planned stop's day when that
 * is today or earlier, otherwise today at the place.
 */
async function defaultVisitDate(ctx: UserContext, input: VisitLogInput): Promise<string> {
  if (input.plan_stop_id) {
    const { data, error } = await ctx.supabase
      .from("plan_stops")
      .select("place:places(tz:google_data->>tz),plan_days!inner(day_number,plans!inner(start_date,user_id))")
      .eq("id", input.plan_stop_id)
      .eq("plan_days.plans.user_id", ctx.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    type Row = {
      place: { tz: string | null } | null;
      plan_days: { day_number: number; plans: { start_date: string | null } };
    };
    const row = data as unknown as Row | null;
    if (!row) throw new VisitInputError("That stop is not part of your plans");
    const today = todayAt(row.place?.tz ?? null);
    const planned = dayDate(row.plan_days.plans.start_date, row.plan_days.day_number);
    return planned && planned <= today ? planned : today;
  }
  const { data, error } = await ctx.supabase
    .from("places")
    .select("tz:google_data->>tz")
    .eq("id", input.place_id!)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return todayAt((data as { tz: string | null } | null)?.tz ?? null);
}

async function finish(
  ctx: UserContext,
  data: unknown
): Promise<VisitWriteResult> {
  const out = data as { visit: { id: string }; created?: boolean; place: PlaceVisitSummary };
  const visit = await getVisit(ctx, out.visit.id);
  if (!visit) throw new VisitNotFoundError();
  return { visit, created: out.created ?? false, place: out.place };
}

/** Logs a visit — or updates the one the place already has that day. */
export async function logVisit(
  ctx: UserContext,
  input: VisitLogInput,
  opts: { createdVia: "app" | "assistant" | "feedback" }
): Promise<VisitWriteResult> {
  const visited_on = input.visited_on ?? (await defaultVisitDate(ctx, input));
  const { data, error } = await ctx.supabase.rpc("log_visit", {
    p_user_id: ctx.userId,
    p_visit: { ...input, visited_on, created_via: opts.createdVia },
  });
  if (error) fail(error);
  return finish(ctx, data);
}

/** Corrects a visit: date, rating, notes (null clears). */
export async function editVisit(ctx: UserContext, visitId: string, changes: VisitEditInput): Promise<VisitWriteResult> {
  const { data, error } = await ctx.supabase.rpc("log_visit", {
    p_user_id: ctx.userId,
    p_visit: { ...changes, visit_id: visitId },
  });
  if (error) fail(error);
  return finish(ctx, data);
}

/** Deletes a visit. A stop it fulfilled is planned again; the place stays
 *  marked visited. */
export async function deleteVisit(
  ctx: UserContext,
  visitId: string
): Promise<{ place: PlaceVisitSummary; reopened_stop_id: string | null }> {
  const { data, error } = await ctx.supabase.rpc("delete_visit", {
    p_user_id: ctx.userId,
    p_visit_id: visitId,
  });
  if (error) fail(error);
  const out = data as { place: PlaceVisitSummary; reopened_stop_id: string | null };
  return { place: out.place, reopened_stop_id: out.reopened_stop_id };
}
