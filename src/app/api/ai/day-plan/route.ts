import { NextRequest, NextResponse, after } from "next/server";
import { generateText, Output } from "ai";
import { propagateAttributes } from "@langfuse/tracing";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { DayPlanSchema, type DayPlanOutput } from "@/lib/ai/schemas/day-plan";
import {
  buildDayPlanSystemPrompt,
  buildDayPlanPrompt,
  type DayPlanCandidate,
  type DayPlanDayFrame,
} from "@/lib/ai/prompts/day-plan";
import { queryPlaces } from "@/lib/places/query-places";
import { isOpenOnDate } from "@/lib/places/open-now";
import { weekdayName } from "@/lib/plans/dates";
import { getPlan, type PlanContext } from "@/lib/plans/read";
import type { PlanOp } from "@/lib/plans/schema";
import { changePlan, PlanInputError, PlanNotFoundError } from "@/lib/plans/write";
import { parsePostgisPoint } from "@/lib/geo";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * POST /api/ai/day-plan — the plan page's "AI Plan" (S4 AI-09, v1.22.0;
 * moved from /api/ai/trip-plan onto the plans model in v1.37.0).
 *
 * Body: { plan_id, include_pool?: boolean, city?: string }
 *
 * Distributes candidate places across the plan's existing days with the
 * LLM: geo/theme grouping + a part of the day per stop + a theme and a
 * short narrative per day. Candidates = the places already in the plan,
 * plus (opt-in) the user's want_to_go pool for a city. Standard AI-route
 * gate skeleton. The usage SKU (`ai_trip_plan`), the budget kind and the
 * telemetry ids keep their names so the history stays in one series.
 *
 * AUGMENTS the k-means auto-plan, does not replace it: same plan, same
 * days, richer ordering + persisted reasoning.
 *
 * WRITE SAFETY: the result is applied as ONE batch of plan changes
 * (apply_plan_changes), so it lands completely or not at all — a failed
 * generation or a rejected batch burns the budget unit (precedent:
 * compare) and leaves the plan untouched. Stops are MOVED, not recreated:
 * their cost, currency and exact time survive by construction. Full
 * rewrite semantics, as the dialog says: a place the model leaves out is
 * removed from the plan.
 */

// Multi-attempt Gemini call + serverless Langfuse flush headroom.
export const maxDuration = 120;

const BodySchema = z
  .object({
    plan_id: z.uuid(),
    include_pool: z.boolean().optional().default(false),
    city: z.string().min(1).max(80).optional(),
  })
  // include_pool without city would silently degrade to an in-plan-only
  // rewrite while still burning a unit — fail fast on the free 400 path.
  .refine((b) => !b.include_pool || !!b.city, {
    message: "city is required when include_pool is true",
  });

const MAX_CANDIDATES = 40;
const MAX_AI_PLAN_DAYS = 14; // DayPlanSchema clamps days at 14 — reject longer plans up front
const TLDR_CHAR_CAP = 400; // rank-results precedent; stored tldr is unbounded
/** HARD output ceiling. Field-tested necessity (16.07.2026, preview): a
 *  6-place London trip sent Gemini into a repetition loop — 830 input
 *  tokens ballooned to 60,684 OUTPUT tokens over 237s before the JSON
 *  failed to parse (responseSchema maxLength is stripped by the Google
 *  provider, so nothing else bounds a degenerate run). A real 14-day
 *  plan fits in ~3k tokens; 5k caps a runaway at ~$0.015 and seconds,
 *  not minutes. */
const MAX_PLAN_OUTPUT_TOKENS = 5000;
/** Degeneration is stochastic (default temperature) — one bounded retry
 *  usually lands a clean generation. Both attempts together still burn
 *  ONE budget unit. */
const MAX_LLM_ATTEMPTS = 2;

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e).slice(0, 500);
  } catch {
    return String(e);
  }
}

/** Hotfix 2 provider config — every knob here is EMPIRICAL (16.07.2026,
 *  4-variant matrix on the real failing input, 3-4 runs each):
 *  - default (responseSchema + thinking): repetition-loop degeneration,
 *    60k-token runaways, 0-1/3 usable.
 *  - no schema, thinking on: degeneration gone, but 2/3 runs emit
 *    syntactically broken JSON (missing commas) on high-thinking runs.
 *  - structuredOutputs:false + thinkingBudget:0 → 4/4 clean, ~4s,
 *    ~640 output tokens. Thinking mode is the pathological factor for
 *    this task on gemini-3-flash-preview; the prompt's JSON template
 *    carries the shape, Output.object still zod-validates server-side.
 *  Do not "simplify" by removing either option without re-running the
 *  matrix. */
const TRIP_PLAN_PROVIDER_OPTIONS = {
  google: {
    structuredOutputs: false,
    thinkingConfig: { thinkingBudget: 0 },
  },
} as const;

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
      { error: "Monthly AI Plan limit reached", used: budget.used, cap: budget.cap },
      { status: 429 }
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { plan_id, include_pool, city } = parsed.data;
  const ctx: PlanContext = { supabase, userId: user.id };

  // ── Load the plan frame ─────────────────────────────────────────
  const plan = await getPlan(ctx, plan_id);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const days = plan.days ?? [];
  if (days.length > MAX_AI_PLAN_DAYS) {
    // The output schema clamps at 14 day entries — a longer plan would
    // silently lose its tail days. Reject before any spend.
    return NextResponse.json(
      { error: `Plans longer than ${MAX_AI_PLAN_DAYS} days aren't supported by AI Plan yet` },
      { status: 400 }
    );
  }

  const dayFrames: DayPlanDayFrame[] = days.map((d) => ({
    day_number: d.day_number,
    date: d.date,
    weekday: d.date ? weekdayName(d.date) : null,
  }));

  // ── Assemble candidates: in-plan places first, then the pool ────
  // An in-plan candidate is a STOP: one per place (a second stop of the
  // same place, a stop without a place and a stop that is already done or
  // skipped are not shown to the model and stay where they are).
  const stopByPlace = new Map<string, { stopId: string; hasExactTime: boolean }>();
  for (const day of days) {
    for (const stop of day.stops ?? []) {
      if (stop.place_id && stop.status === "planned" && !stopByPlace.has(stop.place_id)) {
        stopByPlace.set(stop.place_id, { stopId: stop.id, hasExactTime: !!stop.start_time });
      }
    }
  }

  // More in-plan places than the LLM cap must be rejected BEFORE anything
  // billable happens: the model would never see the ones beyond the cap.
  if (stopByPlace.size > MAX_CANDIDATES) {
    return NextResponse.json(
      { error: `Plan has too many places for AI planning (max ${MAX_CANDIDATES})` },
      { status: 400 }
    );
  }

  // `place` is a full places row: the candidate projection below reads
  // several google_data paths. Bounded by MAX_CANDIDATES.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped places row
  type Row = { place: any; stopId: string | null; hasExactTime: boolean };
  const candidateMap = new Map<string, Row>();
  if (stopByPlace.size > 0) {
    const { data: placeRows, error: placeError } = await supabase
      .from("places")
      .select("*, category:categories(*)")
      .eq("user_id", user.id)
      .in("id", [...stopByPlace.keys()]);
    if (placeError) {
      return NextResponse.json({ error: "Failed to load the plan's places" }, { status: 500 });
    }
    const byId = new Map((placeRows ?? []).map((p) => [p.id as string, p]));
    // Plan order, so the candidate list reads like the plan.
    for (const [placeId, stop] of stopByPlace) {
      const p = byId.get(placeId);
      if (!p) continue;
      candidateMap.set(placeId, {
        place: { ...p, location: p.location ? parsePostgisPoint(p.location) : { lat: 0, lng: 0 } },
        stopId: stop.stopId,
        hasExactTime: stop.hasExactTime,
      });
    }
  }

  if (include_pool && city) {
    const { places: pool } = await queryPlaces(supabase, user.id, {
      city,
      visitStatus: "want_to_go",
      sort: "google_rating_desc",
    });
    for (const p of pool) {
      if (candidateMap.size >= MAX_CANDIDATES) break;
      if (!candidateMap.has(p.id)) candidateMap.set(p.id, { place: p, stopId: null, hasExactTime: false });
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
  const candidates: DayPlanCandidate[] = candidateRows.map(({ place: p, stopId }) => {
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
      // A plan without dates has no weekdays: every flag is "unknown".
      open_by_day: days.map((d) => (d.date ? isOpenOnDate(gd.work_timetable, d.date) : null)),
      in_trip: stopId !== null,
    };
  });

  // ── LLM call (bounded output + one retry on degeneration) ───────
  let generated: DayPlanOutput | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS && !generated; attempt++) {
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
            output: Output.object({ schema: DayPlanSchema }),
            providerOptions: TRIP_PLAN_PROVIDER_OPTIONS,
            system: buildDayPlanSystemPrompt(),
            prompt: buildDayPlanPrompt(plan.name, dayFrames, candidates),
            maxOutputTokens: MAX_PLAN_OUTPUT_TOKENS,
            experimental_telemetry: {
              isEnabled: true,
              functionId: "ai.trip-plan",
              metadata: {
                planId: plan_id,
                candidates: candidates.length,
                days: days.length,
                includePool: include_pool,
                attempt,
              },
            },
          })
      );
      generated = result.output;
    } catch (e) {
      lastError = e;
      log.warn("ai.trip-plan attempt failed", {
        userId: user.id,
        planId: plan_id,
        attempt,
        error: describeError(e),
      });
    }
  }

  if (!generated) {
    log.error("ai.trip-plan failed", {
      userId: user.id,
      planId: plan_id,
      attempts: MAX_LLM_ATTEMPTS,
      error: describeError(lastError),
    });
    // Unit burns on LLM failure (compare precedent) — but the plan is
    // untouched: nothing was written yet.
    trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
    return NextResponse.json(
      { error: "AI plan generation failed — your plan was not modified" },
      { status: 502 }
    );
  }

  // ── Sanitize (idx range, cross-day dedupe, valid + unique days) ──
  const validDayNumbers = new Set(days.map((d) => d.day_number));
  const usedIdx = new Set<number>();
  const seenDayNumbers = new Set<number>();
  const cleanDays = generated.days
    .filter((d) => {
      // First occurrence wins — the LLM occasionally splits one day into
      // two entries; a duplicate would send the same day's stops twice.
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
      { error: "AI produced no usable plan — your plan was not modified" },
      { status: 502 }
    );
  }

  // ── Write: one atomic batch of plan changes ─────────────────────
  const ops: PlanOp[] = [];

  // Full-rewrite semantics: an in-plan candidate the model left out goes.
  candidateRows.forEach((row, idx) => {
    if (row.stopId && !usedIdx.has(idx)) ops.push({ op: "remove_stop", stop_id: row.stopId });
  });

  for (const planDay of cleanDays) {
    planDay.stops.forEach((stop, position) => {
      const row = candidateRows[stop.idx];
      if (row.stopId) {
        // Each move lands on the next free position at the front of the
        // day (see arrangeOps in src/lib/plans/write.ts).
        ops.push({ op: "move_stop", stop_id: row.stopId, day: planDay.day_number, position });
        ops.push({
          op: "update_stop",
          stop_id: row.stopId,
          notes: stop.note ?? null,
          // An exact time the user set is a commitment — keep it.
          ...(row.hasExactTime ? {} : { day_part: stop.time_slot }),
        });
      } else {
        // A pool place joins the plan; its cost default comes from the
        // price level (changePlan).
        ops.push({
          op: "add_stop",
          day: planDay.day_number,
          position,
          place_id: row.place.id,
          day_part: stop.time_slot,
          ...(stop.note ? { notes: stop.note } : {}),
        });
      }
    });
    // Day theme + flowing narrative → the day's note (rendered under the
    // day header): "Start your morning at X…, then…".
    ops.push({
      op: "set_day",
      day: planDay.day_number,
      notes: `${planDay.theme} — ${planDay.narrative}`.slice(0, 2000),
    });
  }

  // Days that got no stops this run must not keep a previous run's
  // theme/rationale — stale notes would describe places no longer there.
  const plannedDays = new Set(cleanDays.map((d) => d.day_number));
  for (const d of days) {
    if (!plannedDays.has(d.day_number)) ops.push({ op: "set_day", day: d.day_number, notes: null });
  }

  try {
    await changePlan(ctx, plan_id, { ops });
  } catch (e) {
    // The generation happened, so the unit is spent either way.
    trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
    if (e instanceof PlanInputError || e instanceof PlanNotFoundError) {
      // The plan was edited while the model was working (a stop removed,
      // a day gone). The batch is all-or-nothing, so nothing was applied.
      log.warn("ai.trip-plan apply rejected", { userId: user.id, planId: plan_id, error: e.message });
      return NextResponse.json(
        { error: "The plan changed while the AI was working — nothing was applied. Try again." },
        { status: 409 }
      );
    }
    log.error("ai.trip-plan apply failed", {
      userId: user.id,
      planId: plan_id,
      error: describeError(e),
    });
    return NextResponse.json(
      { error: "Failed to apply the plan — your plan was not modified" },
      { status: 500 }
    );
  }

  trackAiUsage(user.id, "ai_trip_plan", supabase).catch(() => {});
  log.info("ai.trip-plan", {
    userId: user.id,
    planId: plan_id,
    candidates: candidates.length,
    plannedDays: cleanDays.length,
    placedStops: usedIdx.size,
    budgetUsed: budget.used + 1,
    budgetCap: budget.cap,
  });

  return NextResponse.json({
    success: true,
    // Committed already — a failed read-back is not a failed plan; the
    // client refetches when this is null.
    plan: await getPlan(ctx, plan_id).catch(() => null),
    days: cleanDays.map((d) => ({
      day_number: d.day_number,
      theme: d.theme,
      place_count: d.stops.length,
    })),
    placed: usedIdx.size,
    left_out: candidateRows.length - usedIdx.size,
    tips: generated.tips,
  });
}
