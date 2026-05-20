---
title: "Backfill — grandfather-account re-enrichment (deferred)"
type: plan
domain: ai
version: 1.0.0
last_updated: 20.05.2026
status: draft
related:
  - "[[../06-ops/runbooks/profile-backfill]]"
  - "[[../05-flows/full-profile-flow]]"
  - "[[../05-flows/place-import-flow]]"
tags:
  - backfill
  - deferred
  - grandfather
---

# Backfill — grandfather-account re-enrichment (deferred)

> **Status: DEFERRED — not scheduled.** Captured 20.05.2026 after a live
> diagnosis. Revisit only if a "grandfather" account's AI data quality
> matters. The fix is fully specced below so a future pickup needs no
> re-investigation.

## TL;DR

The AI `place_profile` backfill generates a profile for every place that has
≥ 1 review. On **grandfather accounts** — created before the app moved fully
to DataForSEO — many places have only **≤ 5 reviews and no Google CID**: this
is Google Places API era data (that API caps reviews at 5 and returns no CID).
The backfill profiles them anyway, from those 5 stale reviews → **thin
profiles**: weak `tldr` / `pros` / `cons`, often empty `theme_insights`.

**Deferred on purpose:** the app now enriches exclusively through DataForSEO
(50 reviews + CID), so every *new* place is fine. Only ~1–2 legacy accounts
carry this. Not worth a heavy change for that blast radius — but documented
here in case it ever is.

## Verified data (20.05.2026)

Account `ozanketenci@gmail.com` (`user_id 1eab69ed-…`), 343 places:

| Review bucket | Places | has CID | has `user_ratings_total` | profiled |
|---|---|---|---|---|
| ≤ 5 reviews | 336 | **0** | **0** | 330 (all thin) |
| ≥ 30 reviews | 7 | 6 | 5 | 4 |

All 336 thin places DO have a `ChIJ…` `google_place_id` and coordinates — so
they *can* be re-looked-up via DataForSEO; they just never were.

Example: **Van Stapele Koekmakerij** — 14,926 Google ratings, but its profile
was generated from **5** reviews (`source_review_count: 5`,
`theme_insights: null`).

## Root cause (two layers)

1. **The backfill is review-count-blind.** `backfill-profiles/route.ts`
   treats "≥ 1 review" as "ready" → dispatches `enrich?step=profile`
   directly. `enrich/route.ts` `step=profile` only rejects *zero* reviews
   (`enrich/route.ts:190`) — 5 reviews go straight to Gemini, and
   `source_review_count` is stamped as 5.
2. **Grandfather places have no CID.** `enrich?step=reviews` requires a CID
   (`enrich/route.ts:124`), so a plain "refresh the reviews" cannot run for
   them. They need a full DataForSEO re-lookup by `google_place_id`.

## The fix (if revisited) — 3 changes

### 1. `refresh-google-data` → chain to profile

`src/app/api/places/[id]/refresh-google-data/route.ts` already does the full
re-lookup: biz-info by `place_id:ChIJ…` → captures `cid` → fetches 50 reviews
→ computes `user_ratings_total`. After its `google_data` update, if
`ai_features_enabled` and reviews exist, fire-and-forget `POST
enrich?step=profile` — mirror the existing chain at `enrich/route.ts:148-162`.

Side benefit: a manual review refresh would then regenerate the profile too.
Today it does not (observed: a place re-fetched to 50 reviews kept its
5-review profile).

### 2. Backfill — `classifyPlace()` + a `reenrich` action

`src/app/api/user/backfill-profiles/route.ts` — replace the duplicated bucket
logic (the POST loop + `buildEligibilityReport`) with one `classifyPlace()`.
Constants: `MIN_HEALTHY = 25` reviews; `moreAvailable` = `user_ratings_total`
unknown OR `> current review count`.

| Place state | Action | Route |
|---|---|---|
| Full profile, `source_review_count ≥ 25`, reviews not grown | `ok` | — |
| Full profile, reviews grew past it (≥ 25 now) | `profile` | `enrich?step=profile` |
| Thin (< 25) & `moreAvailable`, has CID | `reviews` | `enrich?step=reviews` |
| Thin (< 25) & `moreAvailable`, no CID, has `ChIJ…` id | **`reenrich`** | `refresh-google-data` |
| ≥ 25 reviews, no full profile | `profile` | `enrich?step=profile` |
| Thin, no CID, no `place_id` | `skip` | — |

Eligibility expands from "no `place_profile`" to "`classifyPlace ∈
{reenrich, reviews, profile}`" — so thin-profiled places become eligible
again. Churn-safe: `refresh-google-data` populates `user_ratings_total`, so a
genuinely small place ends with `total == review count` → `moreAvailable`
false → settles to `ok`.

### 3. (optional) Failure visibility

Backfill dispatches are fire-and-forget with `.catch(console.warn)` → silent
failures (observed: a CID-bearing place left with 0 reviews, 0 profile).
Lightweight fix: surface a stalled eligibility count in the panel, or log
failures through the structured `log.*` so they reach Honeycomb.

## Cost & scope

~336 re-enrichments × ~$0.007 (biz-info + 50 reviews + profile) ≈ **~$2.5**,
~30–45 min through the Settings backfill panel. The `reenrich` leg is heavy
(biz-info + a polled reviews fetch ~30–90 s) — may need a smaller batch than
`MAX_PER_REQUEST = 25` to stay under DataForSEO concurrency.

User data (notes / tags / lists / category / visit status) is untouched —
only `google_data` is refreshed. Fresh profiles may surface new tag/category
proposals in the moderation queue (expected).

## Trigger to revisit

- A grandfather account's owner cares about AI-search / profile quality.
- The pattern reappears (e.g. a new import path that captures < 50 reviews).
- Otherwise leave as-is — DataForSEO-era data (every new place) is unaffected.

## Why not "reset the account"

Considered and rejected: a grandfather account holds the user's real curated
data (places, notes, lists, tags). The fix above re-enriches *in place* for
~$2.5 and keeps everything. A reset would be needless data loss.
