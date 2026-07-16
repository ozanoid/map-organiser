import { NextRequest, NextResponse, after } from "next/server";
import { generateText, Output } from "ai";
import { propagateAttributes } from "@langfuse/tracing";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { TripPlanSchema, type TripPlanOutput } from "@/lib/ai/schemas/trip-plan";
import {
  buildTripPlanSystemPrompt,
  buildTripPlanPrompt,
  type TripPlanCandidate,
  type TripPlanDayFrame,
} from "@/lib/ai/prompts/trip-plan";
import { queryPlaces } from "@/lib/places/query-places";
import { isOpenOnDate } from "@/lib/places/open-now";
import { defaultCostEstimate } from "@/lib/trip/cost-defaults";
import { parsePostgisPoint } from "@/lib/geo";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * POST /api/ai/trip-plan — S4 AI-09 v1 (v1.22.0).
 *
 * Body: { trip_id, include_pool?: boolean, city?: string }
 *
 * Distributes candidate places across the trip's existing days with the
 * LLM: geo/theme grouping + per-stop time slots + per-day theme/rationale.
 * Candidates = places already in the trip, plus (opt-in) the user's
 * want_to_go pool for a city. Standard AI-route gate skeleton.
 *
 * AUGMENTS the k-means auto-plan, does not replace it: same trip entity,
 * same days, richer ordering + persisted reasoning (trip_day_places
 * .time_slot/.notes and trip_days.notes were unused until now).
 *
 * WRITE SAFETY (delete-after-validate): nothing is deleted until the LLM
 * output has been parsed AND sanitized — a failed generation burns the
 * budget unit (precedent: compare) but leaves the trip untouched. The
 * user chose full-rewrite semantics; costs/currency of already-placed
 * rows are carried by place_id, pool entrants get price_level defaults.
 */

const BodySchema = z
  .object({
    trip_id: z.string().uuid(),
    include_pool: z.boolean().optional().default(false),
    city: z.string().min(1).max(80).optional(),
  })
  // include_pool without city would silently degrade to an in-trip-only
  // rewrite while still burning a unit — fail fast on the free 400 path.
  .refine((b) => !b.include_pool || !!b.city, {
    message: "city is required when include_pool is true",
  });

const MAX_CANDIDATES = 40;
const MAX_PLAN_DAYS = 14; // TripPlanSchema clamps days at 14 — reject longer trips up front
const TLDR_CHAR_CAP = 400; // rank-results precedent; stored tldr is unbounded

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  after(flushLangfuse);

  const { data: profile } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .single();
  if (!profile?.ai_features_enabled) {
    return NextResponse.json(
      { error: "AI features are disabled", code: "ai_disabled" },
      { status: 403 }
    );
  }

  const aiClient = getAiClient();
  if (!aiClient) {
    return NextResponse.json(
      { error: "AI is not configured", code: "ai_unavailable" },
      { status: 503 }
    );
  }

  const budget = await checkAiBudget("trip_plan", user.id, supabase);
  if (budget.exceeded) {
    return NextResponse.json(
      { error: "Monthly AI trip-plan limit reached", used: budget.used, cap: budget.cap },
      { status: 429 }
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { trip_id, include_pool, city } = parsed.data;

  // ── Load trip frame ─────────────────────────────────────────────
  const { data: trip } = await supabase
    .from("trips")
    .select("id, name")
    .eq("id", trip_id)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const { data: days } = await supabase
    .from("trip_days")
    .select("id, day_number, date")
    .eq("trip_id", trip_id)
    .order("day_number", { ascending: true });
  if (!days || days.length === 0) {
    return NextResponse.json({ error: "Trip has no days" }, { status: 400 });
  }
  if (days.length > MAX_PLAN_DAYS) {
    // The output schema clamps at 14 day entries — a longer trip would
    // silently lose its tail days. Reject before any spend.
    return NextResponse.json(
      { error: `Trips longer than ${MAX_PLAN_DAYS} days aren't supported by AI Plan yet` },
      { status: 400 }
    );
  }

  const dayFrames: TripPlanDayFrame[] = days.map((d) => ({
    day_number: d.day_number,
    date: d.date,
    weekday:
      WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()] ?? "Unknown",
  }));

  // ── Assemble candidates: in-trip places first, then the pool ────
  const dayIds = days.map((d) => d.id);
  const { data: currentRows } = await supabase
    .from("trip_day_places")
    .select("place_id, cost_estimate, currency, place:places(*, category:categories(*))")
    .in("trip_day_id", dayIds);

  type Row = { place: any; in_trip: boolean };
  const candidateMap = new Map<string, Row>();
  for (const row of currentRows ?? []) {
    const p = row.place as any;
    if (p && !candidateMap.has(p.id)) {
      candidateMap.set(p.id, {
        place: { ...p, location: p.location ? parsePostgisPoint(p.location) : { lat: 0, lng: 0 } },
        in_trip: true,
      });
    }
  }

  // A trip with more in-trip places than the LLM cap must be rejected
  // BEFORE anything destructive (or billable) happens: slicing them away
  // would make the rewrite silently delete every place beyond the cap.
  if (candidateMap.size > MAX_CANDIDATES) {
    return NextResponse.json(
      { error: `Trip has too many places for AI planning (max ${MAX_CANDIDATES})` },
      { status: 400 }
    );
  }

  if (include_pool && city) {
    const { places: pool } = await queryPlaces(supabase, user.id, {
      city,
      visitStatus: "want_to_go",
      sort: "google_rating_desc",
    });
    for (const p of pool) {
      if (candidateMap.size >= MAX_CANDIDATES) break;
      if (!candidateMap.has(p.id)) candidateMap.set(p.id, { place: p, in_trip: false });
    }
  }

  const candidateRows = Array.from(candidateMap.values());
  if (candidateRows.length < 2) {
    return NextResponse.json(
      { error: "Not enough candidate places (need at least 2)" },
      { status: 400 }
    );
  }

  // Compact projection + per-day open flags (never raw timetables).
  const candidates: TripPlanCandidate[] = candidateRows.map(({ place: p, in_trip }) => {
    const gd = p.google_data ?? {};
    const feats = gd.place_profile?.features ?? {};
    return {
      name: p.name,
      category: p.category?.name ?? null,
      lat: p.location?.lat ?? 0,
      lng: p.location?.lng ?? 0,
      rating: gd.rating ?? null,
      ratings_count: gd.user_ratings_total ?? null,
      price_level: gd.price_level ?? null,
      // Stored tldr is unbounded — clamp so one place can't blow up the
      // prompt (rank-results' 400-char precedent).
      tldr:
        typeof gd.place_profile?.tldr === "string"
          ? gd.place_profile.tldr.slice(0, TLDR_CHAR_CAP)
          : null,
      occasions: Array.isArray(feats.occasions) ? feats.occasions : [],
      atmosphere: Array.isArray(feats.atmosphere) ? feats.atmosphere : [],
      open_by_day: days.map((d) => isOpenOnDate(gd.work_timetable, d.date)),
      in_trip,
    };
  });

  // ── LLM call ────────────────────────────────────────────────────
  let plan: TripPlanOutput;
  try {
    const result = await propagateAttributes(
      {
        traceName: "ai-trip-plan",
        userId: user.id,
        tags: ["trip-plan"],
      },
      () =>
        generateText({
          model: aiClient(FLASH_MODEL),
          output: Output.object({ schema: TripPlanSchema }),
          system: buildTripPlanSystemPrompt(),
          prompt: buildTripPlanPrompt(trip.name, dayFrames, candidates),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "ai.trip-plan",
            metadata: {
              tripId: trip_id,
              candidates: candidates.length,
              days: days.length,
              includePool: include_pool,
            },
          },
        })
    );
    plan = result.output;
  } catch (e) {
    log.error("ai.trip-plan failed", {
      userId: user.id,
      tripId: trip_id,
      error: e instanceof Error ? e.message : String(e),
    });
    // Unit burns on LLM failure (compare precedent) — but the trip is
    // untouched: nothing was deleted yet.
    trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
    return NextResponse.json(
      { error: "AI plan generation failed — your trip was not modified" },
      { status: 502 }
    );
  }

  // ── Sanitize (idx range, cross-day dedupe, valid + unique days) ──
  const validDayNumbers = new Set(days.map((d) => d.day_number));
  const usedIdx = new Set<number>();
  const seenDayNumbers = new Set<number>();
  const cleanDays = plan.days
    .filter((d) => {
      // First occurrence wins — the LLM occasionally splits one day into
      // two entries; a duplicate would double-insert into the same
      // trip_day with colliding sort_order.
      if (!validDayNumbers.has(d.day_number) || seenDayNumbers.has(d.day_number))
        return false;
      seenDayNumbers.add(d.day_number);
      return true;
    })
    .map((d) => ({
      ...d,
      stops: d.stops.filter((s) => {
        if (s.idx < 0 || s.idx >= candidateRows.length || usedIdx.has(s.idx)) return false;
        usedIdx.add(s.idx);
        return true;
      }),
    }))
    .filter((d) => d.stops.length > 0);

  if (cleanDays.length === 0) {
    trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
    return NextResponse.json(
      { error: "AI produced no usable plan — your trip was not modified" },
      { status: 502 }
    );
  }

  // ── Write (only now do we delete) ───────────────────────────────
  // TOCTOU: the LLM call takes seconds — re-read the trip rows NOW so
  // (a) cost/currency edits made mid-generation are carried, not
  // clobbered from the stale snapshot, and (b) places added mid-flight
  // (not shown to the LLM) survive via the candidate-scoped delete.
  const { data: freshRows } = await supabase
    .from("trip_day_places")
    .select("place_id, cost_estimate, currency")
    .in("trip_day_id", dayIds);
  const carryByPlace = new Map(
    (freshRows ?? currentRows ?? []).map((r) => [
      r.place_id,
      { cost: r.cost_estimate, cur: r.currency },
    ])
  );

  // Scope the delete to the places the LLM actually saw — any row that
  // was never a candidate must survive the rewrite (defense-in-depth on
  // top of the >MAX_CANDIDATES 400 guard).
  const candidatePlaceIds = candidateRows.map((r) => r.place.id);
  const { error: delError } = await supabase
    .from("trip_day_places")
    .delete()
    .in("trip_day_id", dayIds)
    .in("place_id", candidatePlaceIds);
  if (delError) {
    // Nothing deleted → trip intact; unit already burned above? No —
    // burn happens below, so this failure costs nothing.
    log.error("ai.trip-plan delete failed", {
      userId: user.id,
      tripId: trip_id,
      error: delError.message,
    });
    return NextResponse.json(
      { error: "Failed to apply plan — your trip was not modified" },
      { status: 500 }
    );
  }

  // supabase-js returns errors, it does NOT throw — collect them so a
  // half-applied write is reported honestly instead of success:true.
  const writeErrors: string[] = [];
  for (const planDay of cleanDays) {
    const day = days.find((d) => d.day_number === planDay.day_number)!;
    const { error: insError } = await supabase.from("trip_day_places").insert(
      planDay.stops.map((stop, i) => {
        const row = candidateRows[stop.idx];
        const carry = carryByPlace.get(row.place.id);
        return {
          trip_day_id: day.id,
          place_id: row.place.id,
          sort_order: i,
          time_slot: stop.time_slot,
          notes: stop.note ?? null,
          cost_estimate:
            carry?.cost ?? defaultCostEstimate(row.place.google_data),
          currency: carry?.cur ?? "USD",
        };
      })
    );
    if (insError) {
      writeErrors.push(`day ${planDay.day_number}: ${insError.message}`);
      continue;
    }
    // Day theme + rationale → trip_days.notes (rendered in the day header).
    const { error: noteError } = await supabase
      .from("trip_days")
      .update({ notes: `${planDay.theme} — ${planDay.rationale}` })
      .eq("id", day.id);
    if (noteError) writeErrors.push(`day ${planDay.day_number} notes: ${noteError.message}`);
  }

  // Days that got no stops this run must not keep a previous run's
  // theme/rationale — stale notes would describe places no longer there.
  const plannedDayIds = new Set(
    cleanDays.map((pd) => days.find((d) => d.day_number === pd.day_number)!.id)
  );
  const unplannedDayIds = dayIds.filter((id) => !plannedDayIds.has(id));
  if (unplannedDayIds.length > 0) {
    await supabase
      .from("trip_days")
      .update({ notes: null })
      .in("id", unplannedDayIds);
  }

  if (writeErrors.length > 0) {
    trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
    log.error("ai.trip-plan partial write", {
      userId: user.id,
      tripId: trip_id,
      errors: writeErrors,
    });
    return NextResponse.json(
      {
        error: "Plan was only partially applied — review the trip and retry",
        details: writeErrors,
      },
      { status: 500 }
    );
  }

  trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
  log.info("ai.trip-plan", {
    userId: user.id,
    tripId: trip_id,
    candidates: candidates.length,
    plannedDays: cleanDays.length,
    placedStops: usedIdx.size,
    budgetUsed: budget.used + 1,
    budgetCap: budget.cap,
  });

  return NextResponse.json({
    success: true,
    days: cleanDays.map((d) => ({
      day_number: d.day_number,
      theme: d.theme,
      place_count: d.stops.length,
    })),
    placed: usedIdx.size,
    left_out: candidateRows.length - usedIdx.size,
    tips: plan.tips,
  });
}
