---
title: Periodic place refresh (cron)
type: runbook
domain: ops
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/cron/refresh-places/route.ts
  - src/lib/places/refresh-google-data.ts
  - src/lib/places/freshness.ts
  - src/lib/ai/generate-profile.ts
  - src/lib/google/track-usage.ts
  - vercel.json
related:
  - "[[_README]]"
  - "[[profile-backfill]]"
  - "[[../../05-flows/ai-enrichment-flow]]"
  - "[[../../05-flows/full-profile-flow]]"
  - "[[../../02-backend/schema/api_usage]]"
---

# Periodic place refresh (cron)

> **Telemetry (v1.16.0):** each cron re-profile call exports gen_ai spans to Langfuse under trace `cron-refresh-places` (tag `cron`); the route flushes the batch via `after(flushLangfuse)`. See [[../../05-flows/observability-flow]].

The **refresh waves** (v2, 18.11.2026). The library is refreshed together, on
fixed dates, so every place describes the same moment. v1 (15.07.2026) ran
each place on its own 30-day clock, at most 14 places a day, so one place was
refreshed on the 2nd and its neighbour on the 22nd, and a ~500-place library
took 5–8 weeks to cycle.

## How it works

`vercel.json` schedules `GET /api/cron/refresh-places` **every 2 hours**
(`0 */2 * * *`).

**The whole sweep is opt-in per user** (`profiles.cron_refresh_enabled`,
default **off** — Settings → AI → "Background data refresh"). Users who
haven't opted in are never scanned: no data refresh, no DataForSEO cost,
no profile regeneration.

### The waves (`src/lib/places/freshness.ts`)

| Part | Wave starts (00:00 UTC) | Done for the wave when | Marker |
|---|---|---|---|
| Business info — hours, open/closed status, rating, review count | 1st and 15th of each month | the last successful lookup is at or after the wave start | `google_data.enriched_at` |
| Reviews (sort `newest`; `relevant` in Jan/Jul) | 1st of each month | the last fetch that returned reviews is at or after the wave start | `google_data.reviews_refreshed_at` (falls back to `enriched_at` for places saved before the marker existed) |

A place saved, or refreshed by hand, mid-wave is already past the wave start,
so it simply joins the next wave — the library stays in step.

**Retries.** Before any paid call the run stamps `google_data.biz_attempt` /
`reviews_attempt` = `{ wave, n, at }`. A part that failed is retried in the
same wave after 6 h (`RETRY_AFTER_MS`), at most 3 attempts per wave
(`MAX_ATTEMPTS_PER_WAVE`); after that the place waits for the next wave. A
dead `google_place_id` therefore costs at most three lookups per wave.

### Each run

1. Loads every place of the opted-in owners (paged, 1,000 rows per request)
   with just the freshness markers, and keeps those the current waves still
   owe (`dueParts`).
2. Orders them: places on a trip that ends today or later and starts within
   30 days → places marked `booked` / `want_to_go` → the rest; staler first
   inside each group.
3. Works through the list with `CONCURRENCY` (8) workers until the soft
   deadline. **No per-run place cap.** Per place,
   `refreshPlaceGoogleData(parts, usage: "refresh")` fetches only the parts
   the waves owe:
   - business info: DataForSEO Live → hours, status, rating,
     `user_ratings_total` (`ratingsTotal`), extended data, `enriched_at`;
   - reviews: `sort_by: "newest"`, **merged** into the stored corpus
     (relevance backbone preserved — see `mergeReviews`); during January and
     July (`BACKBONE_REFRESH_MONTHS`) `"relevant"` instead, so twice a year
     Google's current ranking rebuilds the backbone tier.
4. **Re-profiling is thresholded.** Only when the reviews fetch found **more
   than 15 new reviews** (`CRON_REPROFILE_MIN_NEW_REVIEWS`; places with
   reviews but no profile regenerate regardless) AND the owner has
   `ai_features_enabled` → `generatePlaceProfile`. The per-user monthly
   PROFILE budget (1000) applies as everywhere else.
5. Emits a `cron.refresh_places` summary event — also when nobody has opted
   in — and returns it as the response body (visible in Vercel cron logs).

### Budget

The waves bill DataForSEO under **their own SKUs** — `refresh_business_info`
($5.4/1k) and `refresh_reviews` ($7.5/1k) — so a big import in the same month
can't stall a wave. Before each place the run checks the owner's
month-to-date wave spend (from `api_usage`) plus the place's cost against
`monthlyRefreshBudgetUsd(places)` = **1.5 × a normal month** for the owner's
library (floor $2), and skips the owner's remaining places once the next one
would cross it (`budgetSkipped`, `budgetHitUsers`). Costs are reserved before
the call so parallel workers can't overshoot together. Profile regeneration is
outside this budget — the PROFILE budget covers it.

### Throughput

`maxDuration = 800` (Vercel Pro maximum with fluid compute —
vercel.com/docs/functions/configuring-functions/duration). Workers stop picking
new places at `SOFT_DEADLINE_MS` (580 s) so in-flight places — reviews polling
≤ ~110 s, a profile ≤ ~40 s — finish inside the limit. DataForSEO allows 30
simultaneous requests; 8 workers (+2 from the import drain) stay well under.

| Library | Business-info wave | Business info + reviews wave (the 1st) |
|---|---|---|
| ~300 places | first run | first day (~3 runs) |
| 1,000 places | ~2 runs | ~1 day (~11 runs) |

(Estimates: ~6 s per business-info lookup, ~45–60 s per place with reviews.)

## Setup (one-time)

| Env var | Status | Note |
|---|---|---|
| `CRON_SECRET` | set in Vercel (production answered 401 to an unauthenticated call on 18.11.2026) | Vercel sends it as `Authorization: Bearer …` on cron invocations. Route returns 500 until set. |
| Per-user opt-in | Settings → AI → "Background data refresh" | Default off — until at least one user enables it, every run exits with `due: 0, message: "no users opted into background refresh"`. |
| `SUPABASE_SERVICE_ROLE_KEY` | already set (sharing uses it) | Service client for the cross-user scan. |
| `DATAFORSEO_*`, `GOOGLE_GENERATIVE_AI_API_KEY` | already set | Same as the interactive flows. |

## Cost envelope

DataForSEO list prices, checked on dataforseo.com/pricing on 18.11.2026:
business info Live **$0.0054**/place; reviews in the Priority queue (what
`fetchReviews` posts) **$0.0015 per 10** → a depth-50 fetch is **$0.0075**.

| Per month, 289 places | Calculation | USD |
|---|---|---|
| Business info, 2 waves | 289 × 2 × $0.0054 | 3.12 |
| Reviews, 1 wave | 289 × $0.0075 | 2.17 |
| **DataForSEO total** | | **5.29** (budget: 7.93) |
| Profiles (>15 new reviews only) | 78–289 places × ~$0.0095 | 0.74–2.75 |

The profile range is a bound, not a measurement: 78 places in the library have
2,000+ Google reviews (likely past the threshold every month); the upper bound
is every place. The first wave after a long gap sits near the upper bound.
At 1,000 places: DataForSEO ≈ $18.30/month, budget ≈ $27.45.

## Manual trigger / verification

```bash
# Plan only — due counts, estimated cost, budget; no DataForSEO calls, no writes.
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/refresh-places?dry=1" | jq
# Preview one owner's wave before they opt in.
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/refresh-places?dry=1&user=<uuid>" | jq
# Real run.
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/refresh-places" | jq
# → { ok, waves, reviewSort, optedInUsers, due, processed, bizRefreshed,
#     bizInfoFailed, reviewsRefreshed, reviewsEmpty, failed, profiled,
#     profileSkipped, budgetSkipped, remaining, deadlineHit, budgetHitUsers }
```

Measured 18.11.2026 (local dry run against production, owner preview):
289 places, 288 due for both parts, estimated $3.72, budget $7.93.

Honeycomb: query `cron.refresh_places` events for the run history.

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| 500 `CRON_SECRET not configured` | Env var missing | Add it in Vercel, redeploy |
| 401 | Header mismatch (manual call without the secret) | Use the exact secret |
| 500 from the usage scan | `api_usage` unreadable | The run refuses to spend without its ledger; check Supabase |
| `failed` > 0 | Row-level errors (place fetch/update) | Attempt stamped → retried after 6 h, up to 3 per wave (`[cron:refresh]` warnings in logs) |
| `bizInfoFailed` > 0 | DataForSEO biz-info returned nothing — dead/unresolvable `google_place_id` or transient API failure | Retried in the wave up to 3 times. Recurring across waves for the same place → the place is likely gone; consider removing it. |
| `reviewsEmpty` > 0 | Reviews fetch returned nothing (no reviews, or polling timed out) | Retried like the above |
| Profile generation fails mid-run (cap, LLM error) | `profileSkipped` with a `[cron:refresh]` warn | The place waits for the next reviews wave (or the user's manual refresh — the staleness badge points them there) |
| `deadlineHit: true` | The run's time ran out with places still owed | Normal during a wave's first day; the next run (2 h later) carries on |
| `budgetHitUsers` > 0 | The owner's wave spend reached 1.5 × a normal month | Not normal — look for a retry storm or a bug before raising `REFRESH_BUDGET_MULTIPLIER` |

## Tuning

Waves, retries, prices and the budget live in `src/lib/places/freshness.ts`
(`BIZ_WAVE_DAYS`, `REVIEWS_WAVE_DAY`, `RETRY_AFTER_MS`,
`MAX_ATTEMPTS_PER_WAVE`, `*_REFRESH_COST_USD`, `REFRESH_BUDGET_MULTIPLIER`).
Run shape lives at the top of the route (`CONCURRENCY` 8, `SOFT_DEADLINE_MS`
580 000, `DELAY_MS` 300, `TRIP_HORIZON_DAYS` 30).

## Future options (not implemented)

- **Standard queue for reviews**: post the reviews tasks in one run and collect
  them in the next (turnaround ≤ 45 min fits the 2-hour schedule) — half the
  reviews price ($0.00375 per depth-50 fetch, ≈ −$1.08/month at 289 places).
- **Vercel Workflow**: if a single run ever needs to outgrow 800 s, move the
  loop to a durable workflow instead.
- Grandfather re-enrich ([[../../_plans/backfill-grandfather-reenrich]])
  as an additional task type of this same sweep.
