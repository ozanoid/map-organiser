import { NextRequest, NextResponse, after } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshPlaceGoogleData } from "@/lib/places/refresh-google-data";
import { generatePlaceProfile } from "@/lib/ai/generate-profile";
import {
  bizAsOf,
  bizWaveStart,
  dueParts,
  monthlyRefreshBudgetUsd,
  partsCostUsd,
  reviewsAsOf,
  reviewsWaveStart,
  type FreshnessMarkers,
} from "@/lib/places/freshness";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * GET /api/cron/refresh-places — the refresh waves.
 *
 * Invoked by Vercel Cron every 2 hours (vercel.json). The library is
 * refreshed in waves on fixed dates (see lib/places/freshness): business
 * info in the waves starting on the 1st and the 15th of each month, reviews
 * in the wave starting on the 1st. Each run works through everything the
 * current waves still owe until its time runs out; the next run carries on.
 * There is no per-run place cap — a ~300-place wave finishes on its first
 * day and a 1,000-place reviews wave well inside two.
 *
 * The sweep is OPT-IN per user: only owners with
 * `profiles.cron_refresh_enabled` (default OFF — Settings → AI →
 * "Background data refresh") are scanned at all.
 *
 * Order inside a wave: places on a trip in the next 30 days, then places
 * marked booked / want to go, then the rest; staler first within each.
 *
 * Per place — refreshPlaceGoogleData with the parts the waves owe:
 *   1. business info (DataForSEO Live) and/or reviews (sort "newest",
 *      merged into the stored corpus). Twice a year, during
 *      BACKBONE_REFRESH_MONTHS, reviews are fetched "relevant" instead so
 *      Google's current relevance ranking rebuilds the backbone tier.
 *   2. The place_profile is regenerated ONLY when the reviews fetch found
 *      more than CRON_REPROFILE_MIN_NEW_REVIEWS new reviews (or the place
 *      has reviews but no profile) AND the owner has ai_features_enabled.
 *      The per-user monthly PROFILE budget (1000) applies as everywhere.
 *
 * Budget: the waves bill DataForSEO under their own SKUs
 * (refresh_business_info, refresh_reviews). Before each place the run
 * checks the owner's month-to-date wave spend against
 * monthlyRefreshBudgetUsd — 1.5× a normal month for their library size —
 * and stops that owner's wave when the next place would cross it.
 *
 * `?dry=1` plans the run and returns it — due counts, estimated cost,
 * budget — without calling DataForSEO or writing anything. `&user=<id>`
 * previews one owner's wave even before they opt in.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron
 * invocations. Runs on the service-role client — every lib function filters
 * by userId explicitly (no RLS reliance).
 *
 * Throughput: CONCURRENCY workers until SOFT_DEADLINE_MS, then the run
 * stops picking new places so in-flight ones (reviews polling ≤ ~110 s, a
 * profile ≤ ~40 s) finish inside maxDuration. Vercel Pro allows 800 s
 * (vercel.com/docs/functions/configuring-functions/duration, fluid compute).
 * DataForSEO allows 30 simultaneous requests; CONCURRENCY stays well under.
 */
export const maxDuration = 800;

const SOFT_DEADLINE_MS = 580_000;
const CONCURRENCY = 8;
/** Politeness delay between places per worker (DataForSEO). */
const DELAY_MS = 300;
/** PostgREST returns at most 1000 rows per request. */
const PAGE_SIZE = 1000;
/** Places on a trip starting within this many days go first. */
const TRIP_HORIZON_DAYS = 30;
/** Re-profile only when a refresh discovers MORE than this many new
 *  reviews — small trickles don't move a summary enough to justify the
 *  LLM call. (Places with reviews but no profile regenerate regardless.) */
const CRON_REPROFILE_MIN_NEW_REVIEWS = 15;
/** UTC months (0-based) whose waves fetch reviews sort_by "relevant"
 *  instead of "newest" — twice a year the backbone tier gets rebuilt from
 *  Google's current relevance ranking (see mergeReviews). */
const BACKBONE_REFRESH_MONTHS = [0, 6]; // January, July
const REFRESH_SKUS = ["refresh_business_info", "refresh_reviews"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRIORITY_STATUSES = new Set(["booked", "want_to_go"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

interface PlaceRow extends FreshnessMarkers {
  id: string;
  user_id: string;
  name: string;
  visit_status: string | null;
}

interface Job {
  id: string;
  userId: string;
  name: string;
  parts: { biz: boolean; reviews: boolean };
  rank: number;
  staleSince: number;
}

const PLACE_SELECT = [
  "id,user_id,name,visit_status",
  "enriched_at:google_data->>enriched_at",
  "reviews_refreshed_at:google_data->>reviews_refreshed_at",
  "biz_attempt:google_data->biz_attempt",
  "reviews_attempt:google_data->reviews_attempt",
].join(",");

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  // A dry run may name one owner to preview their wave before they opt in.
  const previewUser = dry ? request.nextUrl.searchParams.get("user") : null;
  if (previewUser && !UUID.test(previewUser)) {
    return NextResponse.json({ error: "user must be a uuid" }, { status: 400 });
  }

  // Flush the tail of Langfuse's span batch when the sweep is done —
  // intermediate batches auto-flush during the run.
  after(flushLangfuse);

  const admin = createServiceClient();
  const now = new Date();
  const waves = {
    biz: isoDay(bizWaveStart(now)),
    reviews: isoDay(reviewsWaveStart(now)),
  };

  // The sweep is opt-in per user — scope the scan to opted-in owners
  // (places has no direct FK to profiles, so resolve ids first; user
  // count is tiny).
  const { data: optedIn, error: optErr } = await admin
    .from("profiles")
    .select("id")
    .eq("cron_refresh_enabled", true);
  if (optErr) {
    log.error("cron.refresh_places.optin_scan_failed", optErr, {});
    return NextResponse.json({ error: optErr.message }, { status: 500 });
  }
  const optedInIds = previewUser
    ? [previewUser]
    : (optedIn ?? []).map((p) => p.id as string);
  if (optedInIds.length === 0) {
    const summary = { ok: true, dry, waves, optedInUsers: 0, due: 0 };
    log.info("cron.refresh_places", summary);
    return NextResponse.json({
      ...summary,
      message: "no users opted into background refresh",
    });
  }

  // Every place of the opted-in owners, with just the freshness markers.
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("places")
      .select(PLACE_SELECT)
      .in("user_id", optedInIds)
      .not("google_place_id", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      log.error("cron.refresh_places.scan_failed", error, {});
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const tripPlaceIds = await upcomingTripPlaceIds(admin, optedInIds, now);

  const jobs: Job[] = [];
  const placesPerUser = new Map<string, number>();
  for (const row of rows) {
    placesPerUser.set(row.user_id, (placesPerUser.get(row.user_id) ?? 0) + 1);
    const parts = dueParts(row, now);
    if (!parts.biz && !parts.reviews) continue;
    const stamps = [bizAsOf(row), reviewsAsOf(row)]
      .map((s) => (s ? Date.parse(s) : 0))
      .filter((t) => !Number.isNaN(t));
    jobs.push({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      parts,
      rank: tripPlaceIds.has(row.id)
        ? 0
        : PRIORITY_STATUSES.has(row.visit_status ?? "")
          ? 1
          : 2,
      staleSince: stamps.length ? Math.min(...stamps) : 0,
    });
  }
  jobs.sort((a, b) => a.rank - b.rank || a.staleSince - b.staleSince);

  // Month-to-date wave spend per owner, from the waves' own SKUs.
  const spent = new Map<string, number>(optedInIds.map((id) => [id, 0]));
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const { data: usageRows, error: usageErr } = await admin
    .from("api_usage")
    .select("user_id, count, cost_per_1k")
    .in("user_id", optedInIds)
    .in("sku", REFRESH_SKUS)
    .gte("created_at", firstOfMonth);
  if (usageErr) {
    // Without the ledger the budget cannot be enforced — don't spend blind.
    log.error("cron.refresh_places.usage_scan_failed", usageErr, {});
    return NextResponse.json({ error: usageErr.message }, { status: 500 });
  }
  for (const u of usageRows ?? []) {
    const cost = (Number(u.count) * Number(u.cost_per_1k)) / 1000;
    spent.set(u.user_id as string, (spent.get(u.user_id as string) ?? 0) + cost);
  }
  const budget = new Map(
    optedInIds.map((id) => [id, monthlyRefreshBudgetUsd(placesPerUser.get(id) ?? 0)])
  );

  // Backbone-refresh cycle? (see BACKBONE_REFRESH_MONTHS)
  const reviewSort: "relevant" | "newest" = BACKBONE_REFRESH_MONTHS.includes(
    now.getUTCMonth()
  )
    ? "relevant"
    : "newest";

  if (dry) {
    const users = optedInIds.map((id) => {
      const mine = jobs.filter((j) => j.userId === id);
      return {
        user: id.slice(0, 8),
        places: placesPerUser.get(id) ?? 0,
        dueBiz: mine.filter((j) => j.parts.biz).length,
        dueReviews: mine.filter((j) => j.parts.reviews).length,
        estimatedCostUsd: round2(mine.reduce((s, j) => s + partsCostUsd(j.parts), 0)),
        spentThisMonthUsd: round2(spent.get(id) ?? 0),
        budgetUsd: round2(budget.get(id) ?? 0),
      };
    });
    const summary = { ok: true, dry, waves, reviewSort, optedInUsers: optedInIds.length, due: jobs.length, users };
    log.info("cron.refresh_places", summary);
    return NextResponse.json(summary);
  }

  // Per-owner AI-flag cache (profile-regen gate only — the sweep itself is
  // already scoped to opted-in owners).
  const aiEnabledCache = new Map<string, boolean>();
  async function aiEnabledFor(userId: string): Promise<boolean> {
    const cached = aiEnabledCache.get(userId);
    if (cached !== undefined) return cached;
    const { data } = await admin
      .from("profiles")
      .select("ai_features_enabled")
      .eq("id", userId)
      .single();
    const enabled = Boolean(data?.ai_features_enabled);
    aiEnabledCache.set(userId, enabled);
    return enabled;
  }

  const counts = {
    processed: 0,
    bizRefreshed: 0,
    bizInfoFailed: 0,
    reviewsRefreshed: 0,
    reviewsEmpty: 0,
    failed: 0,
    profiled: 0,
    profileSkipped: 0,
    budgetSkipped: 0,
  };
  const budgetHitUsers = new Set<string>();

  const startedAt = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length && Date.now() - startedAt < SOFT_DEADLINE_MS) {
      const job = jobs[cursor++];

      // Reserve the cost before the call so parallel workers cannot
      // overshoot the budget between them.
      const cost = partsCostUsd(job.parts);
      const userSpent = spent.get(job.userId) ?? 0;
      if (userSpent + cost > (budget.get(job.userId) ?? 0)) {
        budgetHitUsers.add(job.userId);
        counts.budgetSkipped++;
        continue;
      }
      spent.set(job.userId, userSpent + cost);

      counts.processed++;
      try {
        const r = await refreshPlaceGoogleData(admin, {
          placeId: job.id,
          userId: job.userId,
          parts: job.parts,
          reviewSort,
          skipPhoto: true,
          usage: "refresh",
        });
        if (!r.ok) {
          counts.failed++;
          console.warn(`[cron:refresh] ${job.name}: refresh failed — ${r.error}`);
          continue;
        }
        if (job.parts.biz) {
          if (r.bizInfoOk) counts.bizRefreshed++;
          else {
            // The row is still updated and the attempt stamped; the wave
            // retries it (see freshness RETRY_AFTER_MS / MAX_ATTEMPTS).
            counts.bizInfoFailed++;
            console.warn(
              `[cron:refresh] ${job.name}: biz-info returned null (place dead or transient API failure)`
            );
          }
        }
        if (job.parts.reviews) {
          if (r.reviewsFetched) counts.reviewsRefreshed++;
          else counts.reviewsEmpty++;
        }

        // Re-profile only past the diff threshold (or when a profile is
        // missing entirely) — small trickles of reviews don't move a
        // summary enough to justify the LLM call.
        const wantsProfile =
          r.totalReviews > 0 &&
          ((job.parts.reviews && r.newReviews > CRON_REPROFILE_MIN_NEW_REVIEWS) ||
            !r.hadProfile);
        if (wantsProfile && (await aiEnabledFor(job.userId))) {
          // Langfuse trace-level fields for the gen_ai spans inside. The
          // whole sweep is ONE OTel trace; per-place userId still lands on
          // each generation span.
          const p = await propagateAttributes(
            {
              traceName: "cron-refresh-places",
              userId: job.userId,
              tags: ["cron"],
            },
            () => generatePlaceProfile(admin, job.userId, job.id)
          );
          if (p.ok) counts.profiled++;
          else {
            counts.profileSkipped++;
            console.warn(`[cron:refresh] ${job.name}: profile skipped — ${p.reason}`);
          }
        } else {
          counts.profileSkipped++;
        }
      } catch (e) {
        counts.failed++;
        console.error(`[cron:refresh] ${job.name}: unexpected error`, e);
      }
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker)
  );

  const summary = {
    ok: true,
    dry,
    waves,
    reviewSort,
    optedInUsers: optedInIds.length,
    due: jobs.length,
    ...counts,
    remaining: jobs.length - cursor,
    deadlineHit: cursor < jobs.length,
    budgetHitUsers: budgetHitUsers.size,
  };
  log.info("cron.refresh_places", summary);
  return NextResponse.json(summary);
}

/** Places on the owners' trips that end today or later and start within
 *  TRIP_HORIZON_DAYS. */
async function upcomingTripPlaceIds(
  admin: ReturnType<typeof createServiceClient>,
  userIds: string[],
  now: Date
): Promise<Set<string>> {
  const today = isoDay(now);
  const horizon = isoDay(new Date(now.getTime() + TRIP_HORIZON_DAYS * 86_400_000));
  const { data: trips } = await admin
    .from("trips")
    .select("id")
    .in("user_id", userIds)
    .gte("end_date", today)
    .lte("start_date", horizon);
  const tripIds = (trips ?? []).map((t) => t.id as string);
  if (tripIds.length === 0) return new Set();

  const { data: days } = await admin
    .from("trip_days")
    .select("id")
    .in("trip_id", tripIds);
  const dayIds = (days ?? []).map((d) => d.id as string);
  if (dayIds.length === 0) return new Set();

  const { data: stops } = await admin
    .from("trip_day_places")
    .select("place_id")
    .in("trip_day_id", dayIds);
  return new Set((stops ?? []).map((s) => s.place_id as string));
}
