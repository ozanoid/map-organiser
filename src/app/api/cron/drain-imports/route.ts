import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { parsePostgisPoint } from "@/lib/geo";
import { fetchReviews, toLocationCoordinate } from "@/lib/dataforseo/reviews";
import { transformReviews, mergeReviews } from "@/lib/dataforseo/transform";
import { generatePlaceProfile } from "@/lib/ai/generate-profile";
import { importPlace, ensurePlacePhoto } from "@/lib/import/process-place";
import type { ImportPayload } from "@/lib/import/process-place";
import { trackUsage } from "@/lib/google/track-usage";
import {
  stampReviewsChecked,
  reviewsRecentlyChecked,
} from "@/lib/places/reviews-checked";
import type { Category, GoogleReview } from "@/lib/types";

/**
 * Drain the import pipeline.
 *
 * The import work list used to live in the browser: a 330-place file meant 110
 * sequential POSTs driven by a `for` loop in the page, so closing the tab lost
 * everything still queued, and a re-upload paid DataForSEO again for each place
 * that had already landed. `import_job_items` holds the list instead, and this
 * route advances items through it.
 *
 * Each visit moves an item ONE stage — import → reviews → profile → done — so
 * a run never blocks on finishing a whole place, and the soft deadline can cut
 * cleanly wherever it lands. Unclaimed items simply wait for the next run,
 * which is the same resumability `cron/refresh-places` relies on.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, matching the refresh sweep.
 * Both the minute cron and the kick fired at job creation use it.
 */
export const maxDuration = 300;

/** Items pulled per run. Roughly what CONCURRENCY workers clear inside the
 *  soft deadline at the import stage (~17 s/place), so a run rarely returns
 *  work it never touched. */
const CLAIM_SIZE = 24;
/** Parallel workers. Matches cron/refresh-places — the ceiling is DataForSEO
 *  politeness, not CPU. */
const CONCURRENCY = 2;
/** Stop claiming here so the summary log and response always emit before
 *  maxDuration kills the function. */
const SOFT_DEADLINE_MS = 240_000;
/** Politeness delay between DataForSEO calls per worker. */
const DELAY_MS = 500;
/**
 * Skip the run when this many items are already claimed and in flight.
 *
 * Overlap is safe on its own — `claim_import_items` uses FOR UPDATE SKIP
 * LOCKED, so concurrent runners take disjoint items and never double-process.
 * (A session-level advisory lock would be the usual guard, but Supabase pools
 * connections in transaction mode, where such a lock is not reliably held
 * across statements.) What this cap actually protects is spend: a minute cron
 * against a 240 s run means ~4 live runs normally, and this stops a backlog
 * from stacking into an unbounded number of paid lookups.
 */
const MAX_INFLIGHT = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACTIVE_STAGES = ["import", "photo", "reviews", "profile"] as const;

interface JobItem {
  id: string;
  job_id: string;
  user_id: string;
  payload: ImportPayload;
  stage: string;
  attempts: number;
  place_id: string | null;
}

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getDataForSEOClient();
  if (!client) {
    return NextResponse.json({ error: "DataForSEO not configured" }, { status: 500 });
  }

  const admin = createServiceClient();

  const { count: inflight } = await admin
    .from("import_job_items")
    .select("id", { count: "exact", head: true })
    .in("stage", ACTIVE_STAGES)
    .gt("claimed_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  if ((inflight ?? 0) >= MAX_INFLIGHT) {
    return NextResponse.json({ ok: true, claimed: 0, message: "runners already saturated" });
  }

  const { data: claimed, error: claimErr } = await admin.rpc("claim_import_items", {
    p_limit: CLAIM_SIZE,
  });
  if (claimErr) {
    console.error("[drain-imports] claim failed:", claimErr);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const items = (claimed ?? []) as JobItem[];
  if (items.length === 0) {
    await finalizeJobs(admin);
    return NextResponse.json({ ok: true, claimed: 0, message: "nothing queued" });
  }

  // Per-owner category cache — resolveCategoryId needs the user's own set, and
  // a job's items all belong to one owner in practice.
  const categoryCache = new Map<string, Category[]>();
  async function categoriesFor(userId: string): Promise<Category[]> {
    const hit = categoryCache.get(userId);
    if (hit) return hit;
    const { data } = await admin.from("categories").select("*").eq("user_id", userId);
    const cats = (data ?? []) as Category[];
    categoryCache.set(userId, cats);
    return cats;
  }

  // Job defaults (visit status, lists, tags) are per job, not per item.
  const jobCache = new Map<string, { visit_status: string | null; list_ids: string[]; tag_ids: string[] }>();
  async function defaultsFor(jobId: string) {
    const hit = jobCache.get(jobId);
    if (hit) return hit;
    const { data } = await admin
      .from("import_jobs")
      .select("visit_status, list_ids, tag_ids")
      .eq("id", jobId)
      .single();
    const d = {
      visit_status: (data?.visit_status as string | null) ?? null,
      list_ids: (data?.list_ids as string[]) ?? [],
      tag_ids: (data?.tag_ids as string[]) ?? [],
    };
    jobCache.set(jobId, d);
    return d;
  }

  /**
   * Write the item's new stage and release its claim.
   *
   * `attempts` resets whenever the stage actually moves, so it counts failed
   * tries AT THE CURRENT STAGE rather than total visits. Without the reset it
   * counted both: a healthy item spends exactly three claims walking
   * import → reviews → profile, which is the whole retry budget, so one
   * transient failure anywhere left the item stranded — never claimable again,
   * never terminal, and `finalizeJobs` only closes a job once no active items
   * remain, so the job would stay `running` forever.
   */
  async function advance(
    item: JobItem,
    patch: { stage: string; place_id?: string | null; reason?: string | null }
  ) {
    await admin
      .from("import_job_items")
      .update({
        stage: patch.stage,
        place_id: patch.place_id ?? item.place_id,
        reason: patch.reason ?? null,
        claimed_at: null,
        ...(patch.stage !== item.stage && { attempts: 0 }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
  }

  const counts = {
    imported: 0,
    photographed: 0,
    skipped: 0,
    failed: 0,
    reviewed: 0,
    profiled: 0,
    done: 0,
  };
  const startedAt = Date.now();
  let cursor = 0;

  async function worker() {
    while (cursor < items.length && Date.now() - startedAt < SOFT_DEADLINE_MS) {
      const item = items[cursor++];
      try {
        if (item.stage === "import") {
          const defaults = await defaultsFor(item.job_id);
          const outcome = await importPlace(
            admin,
            client!,
            item.user_id,
            item.payload,
            {
              visitStatus: defaults.visit_status,
              listIds: defaults.list_ids,
              tagIds: defaults.tag_ids,
            },
            await categoriesFor(item.user_id)
          );

          if (outcome.status === "imported") {
            counts.imported++;
            await advance(item, { stage: "photo", place_id: outcome.placeId });
          } else if (outcome.status === "skipped") {
            counts.skipped++;
            await advance(item, {
              stage: "skipped",
              place_id: outcome.placeId ?? null,
              reason: outcome.reason,
            });
          } else {
            counts.failed++;
            await advance(item, { stage: "failed", reason: outcome.reason });
          }
          await sleep(DELAY_MS);
          continue;
        }

        if (item.stage === "photo") {
          // A missing photo never blocks the place — it just moves on with the
          // reason recorded, so the item stays visible instead of vanishing the
          // way the old inline download did.
          const result = item.place_id
            ? await ensurePlacePhoto(admin, client!, item.user_id, item.place_id)
            : "unavailable";
          if (result === "stored") counts.photographed++;

          // A place that already has a profile was enriched on an earlier pass
          // — this item exists only to repair its photo. Sending it on would
          // re-fetch reviews it already has and re-run the LLM over them, at
          // real cost, and could churn its tags for nothing.
          const enriched = item.place_id
            ? await alreadyEnriched(item.place_id)
            : false;
          await advance(item, {
            stage: enriched ? "done" : "reviews",
            reason: result === "unavailable" ? "No photo available" : null,
          });
          continue;
        }

        if (item.stage === "reviews") {
          const ok = await enrichReviews(item);
          if (ok) counts.reviewed++;
          // No reviews means no profile is possible — the place is finished
          // either way, it just has less on it.
          await advance(item, { stage: ok ? "profile" : "done", reason: ok ? null : "No reviews" });
          await sleep(DELAY_MS);
          continue;
        }

        if (item.stage === "profile") {
          const result = item.place_id
            ? await generatePlaceProfile(admin, item.user_id, item.place_id)
            : null;
          if (result?.ok) counts.profiled++;
          counts.done++;
          await advance(item, {
            stage: "done",
            reason: result && !result.ok ? result.reason : null,
          });
          continue;
        }
      } catch (e) {
        console.error(`[drain-imports] item ${item.id} (${item.stage}) threw:`, e);
        // Leave the stage alone and release the claim: attempts already ticked
        // up, so a persistently throwing item retires itself after 3 tries
        // rather than blocking the queue forever.
        const retire = item.attempts >= 3;
        await advance(item, {
          stage: retire ? "failed" : item.stage,
          reason: retire ? "Repeated errors" : null,
        });
        if (retire) counts.failed++;
      }
    }
  }

  /** Has this place already been through reviews + profile on an earlier pass? */
  async function alreadyEnriched(placeId: string): Promise<boolean> {
    const { data } = await admin
      .from("places")
      .select("google_data")
      .eq("id", placeId)
      .single();
    const gd = (data?.google_data as Record<string, unknown>) ?? {};
    return Boolean(gd.place_profile);
  }

  async function enrichReviews(item: JobItem): Promise<boolean> {
    if (!item.place_id) return false;
    const { data: place } = await admin
      .from("places")
      .select("google_data, location, country")
      .eq("id", item.place_id)
      .single();
    if (!place) return false;

    const gd = (place.google_data as Record<string, unknown>) || {};
    const cid = gd.cid as string | undefined;
    if (!cid) return false;
    // Already asked recently and got nothing — don't pay for the same answer.
    if (reviewsRecentlyChecked(gd)) return false;

    const reviews = await fetchReviews(client!, {
      cid,
      depth: 50,
      location_coordinate: toLocationCoordinate(
        place.location ? parsePostgisPoint(place.location as string) : null
      ),
      location_name: (place.country as string | null) || "United Kingdom",
    });
    if (!reviews || reviews.length === 0) {
      await stampReviewsChecked(admin, item.place_id);
      return false;
    }

    await trackUsage(item.user_id, "dataforseo_reviews");
    await admin
      .from("places")
      .update({
        google_data: {
          ...gd,
          reviews: mergeReviews(
            (gd.reviews as GoogleReview[] | undefined) ?? [],
            transformReviews(reviews),
            { incomingOrder: "relevant" }
          ),
        },
      })
      .eq("id", item.place_id);
    return true;
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Items claimed but never reached (soft deadline) still hold a claim; drop it
  // so the next run picks them up immediately instead of waiting out the
  // 10-minute stale window.
  //
  // `release_import_items` also gives back the attempt the claim charged them.
  // Claiming is not attempting: a run routinely takes more than it can finish —
  // the reviews stage polls DataForSEO for 30-110 s per place, so CONCURRENCY
  // workers clear well under CLAIM_SIZE inside the deadline. Charging the
  // remainder anyway retired healthy places as `failed` after three releases.
  const untouched = items.slice(cursor).map((i) => i.id);
  if (untouched.length > 0) {
    await admin.rpc("release_import_items", { p_ids: untouched });
  }

  await finalizeJobs(admin);

  // Hand off to the next run rather than waiting for the cron minute.
  //
  // This is not just a latency win. Vercel Cron fires on PRODUCTION only, so on
  // a preview deployment the kick at job creation would be the single run an
  // import ever got and the job would stall with everything still queued.
  //
  // Guarded on having made progress: chaining when `processed` is 0 would spin
  // against a queue that cannot move. Depth is bounded anyway — the next run
  // re-checks MAX_INFLIGHT and stops when the claim comes back empty.
  const chained = cursor > 0 && (await hasClaimableWork(admin));
  if (chained) kickSelf(request.nextUrl.origin, secret);

  const summary = {
    ok: true,
    claimed: items.length,
    processed: cursor,
    released: untouched.length,
    chained,
    ...counts,
    elapsed_ms: Date.now() - startedAt,
  };
  console.log("[drain-imports]", JSON.stringify(summary));
  return NextResponse.json(summary);
}

/** Is anything left that a next run could actually claim? */
async function hasClaimableWork(
  admin: ReturnType<typeof createServiceClient>
): Promise<boolean> {
  const { data } = await admin
    .from("import_job_items")
    .select("id, import_jobs!inner(status)")
    .in("stage", ACTIVE_STAGES)
    .lt("attempts", 3)
    .eq("import_jobs.status", "running")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

function kickSelf(origin: string, secret: string) {
  void fetch(`${origin}/api/cron/drain-imports`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {});
}

/** Close out any running job that has no active items left. */
async function finalizeJobs(admin: ReturnType<typeof createServiceClient>) {
  const { data: running } = await admin
    .from("import_jobs")
    .select("id")
    .eq("status", "running");
  for (const job of running ?? []) {
    const { count } = await admin
      .from("import_job_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id as string)
      .in("stage", ACTIVE_STAGES);
    if ((count ?? 0) === 0) {
      await admin
        .from("import_jobs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", job.id as string);
    }
  }
}
