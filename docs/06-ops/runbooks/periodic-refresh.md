---
title: Periodic place refresh (cron)
type: runbook
domain: ops
version: 1.1.0
last_updated: 15.07.2026
status: stable
sources:
  - src/app/api/cron/refresh-places/route.ts
  - src/lib/places/refresh-google-data.ts
  - src/lib/ai/generate-profile.ts
  - vercel.json
related:
  - "[[_README]]"
  - "[[profile-backfill]]"
  - "[[../../05-flows/ai-enrichment-flow]]"
  - "[[../../05-flows/full-profile-flow]]"
---

# Periodic place refresh (cron)

The **AI-22 v1** data-freshness sweep. A daily Vercel Cron keeps every
place's Google data and AI profile from going stale — the systemic answer
to "reviews refresh but the summary doesn't".

## How it works

`vercel.json` schedules `GET /api/cron/refresh-places` daily at 03:00 UTC.

**The whole sweep is opt-in per user** (`profiles.cron_refresh_enabled`,
default **off** — Settings → AI → "Background data refresh"). Users who
haven't opted in are never scanned: no data refresh, no DataForSEO cost,
no profile regeneration. Each run:

1. Selects the **stalest places** among opted-in owners:
   `google_data->>refresh_attempted_at` missing or older than `STALE_DAYS`
   (30), `google_place_id` present. Oldest first, up to `BATCH_SIZE` (14)
   per run. The marker is stamped on **every attempt** (success or not) —
   a place whose DataForSEO lookup permanently fails is retried next
   cycle, not daily, so it can't starve the batch.
2. Per place — `refreshPlaceGoogleData` (service client, `skipPhoto`):
   DataForSEO biz-info + extended data (stamps a fresh `enriched_at`) +
   reviews with `sort_by: "newest"`, **merged** into the stored corpus
   (relevance backbone preserved — see `mergeReviews`).
3. **Re-profiling is thresholded.** Only when the refresh discovered
   **more than 15 new reviews** (`CRON_REPROFILE_MIN_NEW_REVIEWS`; places
   with reviews but no profile regenerate regardless) AND the owner has
   `ai_features_enabled` → `generatePlaceProfile`. The per-user monthly
   PROFILE budget (1000) applies as everywhere else.
4. **Backbone refresh cycles:** during January and July (UTC,
   `BACKBONE_REFRESH_MONTHS`) the sweep fetches `sort_by: "relevant"`
   instead of `"newest"`, so twice a year Google's current relevance
   ranking rebuilds each place's backbone tier (see `mergeReviews`).
5. Emits a `cron.refresh_places` summary event (Honeycomb) + returns it
   as the response body (visible in Vercel cron logs).

Throughput: **up to** 14 places/day. Workers stop picking new places at
the 240 s soft deadline (`SOFT_DEADLINE_MS`) so the summary always gets
emitted before `maxDuration = 300` kills the run — slow review-polling
days simply process fewer (unprocessed places stay unstamped → head of
the next run). A ~500-place library cycles in roughly 5-8 weeks.
`CONCURRENCY = 2` workers, 500 ms politeness delay.

## Setup (one-time)

| Env var | Status | Note |
|---|---|---|
| `CRON_SECRET` | **must be added** (Vercel → Settings → Env) | Any long random string. Vercel automatically sends it as `Authorization: Bearer …` on cron invocations. Route returns 500 until set. |
| Per-user opt-in | Settings → AI → "Background data refresh" | Default off — until at least one user enables it, every run exits with `scanned: 0, message: "no users opted into background refresh"`. |
| `SUPABASE_SERVICE_ROLE_KEY` | already set (sharing uses it) | Service client for the cross-user scan. |
| `DATAFORSEO_*`, `GOOGLE_GENERATIVE_AI_API_KEY` | already set | Same as the interactive flows. |

## Cost envelope

- DataForSEO: biz-info (~$0.0054) + reviews (~$0.004) ≈ **$0.01/place** →
  full monthly cycle over ~450 places ≈ **$4-5/month**.
- Gemini (only when new reviews): ~$0.01/profile at Gemini 3 Flash rates.
  Typical month (a fraction of places actually change) ≈ **$1-3**.

## Manual trigger / verification

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/refresh-places" | jq
# → { ok, scanned, processed, deadlineHit, refreshed, failed,
#     bizInfoFailed, profiled, profileSkipped, staleDays }
```

Honeycomb: query `cron.refresh_places` events for the run history.

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| 500 `CRON_SECRET not configured` | Env var missing | Add it in Vercel, redeploy |
| 401 | Header mismatch (manual call without the secret) | Use the exact secret |
| `failed` > 0 in summary | Row-level errors (place fetch/update) | `refresh_attempted_at` unstamped for those → retried next run (`[cron:refresh]` warnings in logs) |
| `bizInfoFailed` > 0 | DataForSEO biz-info returned nothing — dead/unresolvable `google_place_id` or transient API failure | Row still updated + marker stamped → retried next **cycle** (30 d), not daily. Recurring for the same place → the place is likely gone; consider removing it. |
| Profile generation fails mid-run (cap, LLM error) | `profileSkipped` with a `[cron:refresh]` warn | Known limitation: the place waits for the next cycle (or the user's manual refresh — the staleness badge points them there). |
| `deadlineHit: true` | Slow review polling — soft deadline stopped the batch early | Normal; leftovers lead the next run. Persistent → lower `BATCH_SIZE` or raise `maxDuration` (plan permitting). |

## Tuning

Constants at the top of the route: `STALE_DAYS` (30), `BATCH_SIZE` (14),
`CONCURRENCY` (2), `DELAY_MS` (500). Monthly cadence ≈
`BATCH_SIZE × 30 ≥ library size`.

## Future options (not implemented)

- **Vercel Workflow**: if the batch ever needs to grow past what one
  function invocation can hold, move the loop to a durable workflow
  (pause/resume/retries) instead of raising `maxDuration`.
- Grandfather re-enrich ([[../../_plans/backfill-grandfather-reenrich]])
  as an additional task type of this same sweep.
