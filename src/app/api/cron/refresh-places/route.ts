import { NextRequest, NextResponse, after } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshPlaceGoogleData } from "@/lib/places/refresh-google-data";
import { generatePlaceProfile } from "@/lib/ai/generate-profile";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * GET /api/cron/refresh-places — periodic data-freshness sweep (AI-22 v1).
 *
 * Invoked by Vercel Cron (see vercel.json; daily). The whole sweep is
 * OPT-IN per user: only owners with `profiles.cron_refresh_enabled`
 * (default OFF — Settings → AI → "Background data refresh") have their
 * places scanned at all. Among those, each run picks the stalest places
 * — no `google_data.refresh_attempted_at` or older than STALE_DAYS. The
 * marker is stamped on EVERY attempt (success or not), so a place whose
 * DataForSEO lookup permanently fails cannot sort to the head of every
 * batch and starve the sweep. Per place:
 *
 *   1. Full DataForSEO re-lookup — biz info + extended data + reviews
 *      merged into the stored corpus (see mergeReviews). Most cycles
 *      fetch sort_by "newest" (feeds the pool tier); during
 *      BACKBONE_REFRESH_MONTHS the sweep fetches "relevant" instead, so
 *      twice a year Google's current relevance ranking rebuilds each
 *      place's backbone tier.
 *   2. Regenerate the place_profile ONLY when the refresh discovered
 *      more than CRON_REPROFILE_MIN_NEW_REVIEWS new reviews (or the
 *      place has reviews but no profile at all) AND the owner has
 *      ai_features_enabled. The per-user monthly PROFILE budget (1000)
 *      applies as everywhere else.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron
 * invocations when the env var is set. Runs on the service-role client —
 * both lib functions filter by userId explicitly (no RLS reliance).
 *
 * Throughput: UP TO BATCH_SIZE places/run with CONCURRENCY workers.
 * Reviews are task-polled (~30-110 s worst case/place), so a full batch
 * can exceed maxDuration — workers therefore stop picking new places
 * once SOFT_DEADLINE_MS elapses and the run exits cleanly with a partial
 * batch (unprocessed places stay unstamped → picked first next run). A
 * full library (~500 places) cycles in roughly 5-8 weeks at one daily
 * run.
 */
export const maxDuration = 300;

const STALE_DAYS = 30;
const BATCH_SIZE = 14;
const CONCURRENCY = 2;
/** Politeness delay between places per worker (DataForSEO). */
const DELAY_MS = 500;
/** Stop picking new places after this much elapsed time so the summary
 *  log + response always get emitted well before maxDuration kills us. */
const SOFT_DEADLINE_MS = 240_000;
/** Re-profile only when a refresh discovers MORE than this many new
 *  reviews — small trickles don't move a summary enough to justify the
 *  LLM call. (Places with reviews but no profile regenerate regardless.) */
const CRON_REPROFILE_MIN_NEW_REVIEWS = 15;
/** UTC months (0-based) whose cycles fetch sort_by "relevant" instead of
 *  "newest" — twice a year the backbone tier gets rebuilt from Google's
 *  current relevance ranking (see mergeReviews). */
const BACKBONE_REFRESH_MONTHS = [0, 6]; // January, July

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // Flush the tail of Langfuse's span batch when the sweep is done —
  // intermediate batches auto-flush during the (up to 300s) run.
  after(flushLangfuse);

  const admin = createServiceClient();

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
  const optedInIds = (optedIn ?? []).map((p) => p.id as string);
  if (optedInIds.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: 0,
      message: "no users opted into background refresh",
    });
  }

  const cutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: stalePlaces, error } = await admin
    .from("places")
    .select("id, user_id, name")
    .in("user_id", optedInIds)
    .not("google_place_id", "is", null)
    .or(
      `google_data->>refresh_attempted_at.is.null,google_data->>refresh_attempted_at.lt.${cutoff}`
    )
    .order("google_data->>refresh_attempted_at", {
      ascending: true,
      nullsFirst: true,
    })
    .limit(BATCH_SIZE);

  if (error) {
    log.error("cron.refresh_places.scan_failed", error, {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!stalePlaces || stalePlaces.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, message: "nothing stale" });
  }

  // Backbone-refresh cycle? (see BACKBONE_REFRESH_MONTHS)
  const reviewSort: "relevant" | "newest" = BACKBONE_REFRESH_MONTHS.includes(
    new Date().getUTCMonth()
  )
    ? "relevant"
    : "newest";

  // Per-owner AI-flag cache (profile-regen gate only — the sweep itself
  // is already scoped to opted-in owners at scan time).
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

  let processed = 0;
  let refreshed = 0;
  let failed = 0;
  let bizInfoFailed = 0;
  let profiled = 0;
  let profileSkipped = 0;

  const startedAt = Date.now();
  let cursor = 0;
  async function worker() {
    while (
      cursor < stalePlaces!.length &&
      Date.now() - startedAt < SOFT_DEADLINE_MS
    ) {
      const place = stalePlaces![cursor++];
      processed++;
      try {
        const r = await refreshPlaceGoogleData(admin, {
          placeId: place.id as string,
          userId: place.user_id as string,
          reviewSort,
          skipPhoto: true,
        });
        if (!r.ok) {
          failed++;
          console.warn(
            `[cron:refresh] ${place.name}: refresh failed — ${r.error}`
          );
          continue;
        }
        refreshed++;
        if (!r.bizInfoOk) {
          // Row updated (marker stamped, reviews possibly merged via the
          // stored cid) but the biz-info lookup returned nothing — surface
          // it so dead google_place_ids are visible in the summary.
          bizInfoFailed++;
          console.warn(
            `[cron:refresh] ${place.name}: biz-info returned null (place dead or transient API failure)`
          );
        }

        // Re-profile only past the diff threshold (or when a profile is
        // missing entirely) — small trickles of reviews don't move a
        // summary enough to justify the LLM call.
        const wantsProfile =
          r.totalReviews > 0 &&
          (r.newReviews > CRON_REPROFILE_MIN_NEW_REVIEWS || !r.hadProfile);
        if (wantsProfile && (await aiEnabledFor(place.user_id as string))) {
          // Langfuse trace-level fields for the gen_ai spans inside. The
          // whole sweep is ONE OTel trace; per-place userId still lands on
          // each generation span (single-user in practice, so no clashes).
          const p = await propagateAttributes(
            {
              traceName: "cron-refresh-places",
              userId: place.user_id as string,
              tags: ["cron"],
            },
            () =>
              generatePlaceProfile(
                admin,
                place.user_id as string,
                place.id as string
              )
          );
          if (p.ok) profiled++;
          else {
            profileSkipped++;
            console.warn(
              `[cron:refresh] ${place.name}: profile skipped — ${p.reason}`
            );
          }
        } else {
          profileSkipped++;
        }
      } catch (e) {
        failed++;
        console.error(`[cron:refresh] ${place.name}: unexpected error`, e);
      }
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, stalePlaces.length) }, worker)
  );

  const summary = {
    ok: true,
    scanned: stalePlaces.length,
    processed,
    deadlineHit: processed < stalePlaces.length,
    refreshed,
    failed,
    bizInfoFailed,
    profiled,
    profileSkipped,
    reviewSort,
    optedInUsers: optedInIds.length,
    staleDays: STALE_DAYS,
  };
  log.info("cron.refresh_places", summary);
  return NextResponse.json(summary);
}
