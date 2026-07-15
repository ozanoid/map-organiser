---
title: DataForSEO Business Data
type: integration
domain: integrations
version: 1.3.0
last_updated: 15.07.2026
status: stable
sources:
  - src/lib/dataforseo/
related:
  - "[[../01-domain/places]]"
  - "[[google-places]]"
  - "[[../02-backend/schema/api_usage]]"
  - "[[../02-backend/api-routes/places]]"
---

# DataForSEO Business Data

> **v1.18.0:** structured `work_hours.timetable` is now STORED as `google_data.work_timetable` (was converted to weekday_text and discarded) + `google_data.tz` (IANA, from coordinates via tz-lookup at extraction) — feeds the dynamic open-now computation. See [[../05-flows/place-import-flow]] & `src/lib/places/open-now.ts`.

> **v1.17.0 (S1-PR1):** `current_status` extraction path fixed (`work_time.work_hours.current_status` — the old top-level read never matched; 0/471 places had it) and `transformReviews` now carries `owner_answer`, `owner_time_ago`, `images` (≤6), `local_guide`, `votes_count` onto stored reviews. Dead `transformExtendedReviews` removed. `open_now` derivation in `opening-hours-adapter.ts` fixed the same way.

The default enrichment provider. Used for **all** bulk imports and as the fallback for single-place parses. Provides rich Google-derived data via a server-side API.

## Account & access

- **Provider:** [DataForSEO](https://dataforseo.com/) — Business Data API v3.
- **Auth:** HTTP Basic auth (`Authorization: Basic <base64(login:password)>`).
- **Account owner:** the maintainer (ozan).

## NPM packages

None — calls are `fetch` from server-side. Implementation in `src/lib/dataforseo/`.

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `DATAFORSEO_LOGIN` | **server only** | Basic-auth username |
| `DATAFORSEO_PASSWORD` | **server only** | Basic-auth password |

There are also `profiles.dataforseo_login_enc` and `profiles.dataforseo_password_enc` columns for future per-user credentials, but **no API surface today** exposes them. Bulk import uses the env-level account exclusively.

## What we call

Implementation in `src/lib/dataforseo/`:

| File | Purpose |
|---|---|
| `client.ts` | Low-level HTTP client; auth header construction. |
| `api-types.ts` | Type definitions for DataForSEO responses. |
| `business-info.ts` | `fetchBusinessInfoLive(query)` — the main endpoint. Returns full business profile. |
| `reviews.ts` | `fetchReviews({cid, depth, sort_by})` — reviews endpoint. Default sort `relevant` (initial/import — establishes the relevance backbone); refreshes pass `newest` to discover new reviews. |
| `transform.ts` | `transformBusinessInfoToPlaceData(response)` → `ParsedPlaceData`. |
| `category-adapter.ts` | DataForSEO category string → one of our 12 default categories. |
| `opening-hours-adapter.ts` | DataForSEO `work_time` → `weekday_text[]` + `open_now`. |
| `price-level-adapter.ts` | DataForSEO `price_level` → numeric 0–4. |
| `photo.ts` | `downloadAndStorePhotoFromUrl(url, ...)` → uploads to Supabase Storage. |

## Where it's used

| Caller | Purpose |
|---|---|
| `/api/places/parse-link` | Fallback when Google is disabled or unavailable. |
| `/api/places/import-batch` | **Primary path for bulk import.** Every batch of 3 places goes through DataForSEO. |
| `/api/places/[id]/enrich?step=info` | Re-enrich a single place's business info. |
| `/api/places/[id]/enrich?step=reviews` | Fetch reviews for a place. |
| `/api/places/[id]/refresh-google-data` | Full re-lookup: info + `newest` reviews **merged** into the corpus (`mergeReviews`, not replace) + chains to `step=profile`. Also runs headless in the cron. |
| `/api/places/bulk-enrich-reviews` | Background bulk review enrichment (batch=5, depth=50). |

## SKUs tracked

- `dataforseo.business_info` — Business Info Live calls.
- `dataforseo.reviews` — Reviews calls.

Each call → +1 in `api_usage`. `cost_per_1k` is set per DataForSEO's price.

## Cost model

DataForSEO charges per request. Bulk import of N places ≈ N `business_info` calls + (post-import) ceil(N/5) `reviews` batch calls.

Rough cost per 1000 places (verify against current DataForSEO pricing):

- Business Info: ~$2 / 1000 = $2 for 1000 places.
- Reviews (depth=50): ~$3 / 1000 = $3 if every place gets reviews.

Cheap compared to Google Places. The system-level account holds DataForSEO credit.

## Response shape (Business Info)

Subset of fields we actually use (see `api-types.ts` for the full schema):

```
result[].items[].title           — place name
result[].items[].address         — full address
result[].items[].latitude / longitude
result[].items[].place_id        — Google place_id
result[].items[].cid             — Google CID (used for reviews + Maps URL)
result[].items[].rating
result[].items[].rating_distribution
result[].items[].photos
result[].items[].url             — main photo URL
result[].items[].work_time.work_hours — timetable + current_status
                                   (current_status is NESTED here — v1.17.0 fix)
result[].items[].phone, website
result[].items[].price_level
result[].items[].is_claimed, total_photos
result[].items[].description
result[].items[].book_online_url
result[].items[].popular_times
result[].items[].place_topics
result[].items[].attributes
result[].items[].local_business_links
result[].items[].people_also_search
```

These map into `places.google_data` (DataForSEO-extended subset) via `transformBusinessInfoToPlaceData`.

## Failure modes

- **Bad credentials:** 401. Route returns 500 to the client. Verify env vars.
- **Quota exhausted:** 4xx. Same — verify account balance.
- **Place not found:** the result set is empty. Parse-link returns 404; bulk import marks the place as `skipped`.
- **Timeout:** the `_Live` endpoints are synchronous and can be slow (~3-4s per call). The 60s Vercel Function default is the hard cap; if we hit it, batch sizes need to shrink.

## Per-user opt-out

There isn't one. DataForSEO is the system-wide enrichment provider; users can only toggle off Google to **force** DataForSEO, not the other way around.

## Replacement strategy

If we drop DataForSEO:

- Bulk import would need to use Google Places (per-user keys), which is per-user-cost.
- Reviews specifically are tricky — Google Place Details returns reviews but is expensive.
- Alternative providers: HERE, Foursquare/Places, SerpAPI. None are drop-ins; each has its own data shape and pricing.

## Open questions

- **Per-user DataForSEO billing.** Schema columns exist but no API. If we ever want users to bring their own DataForSEO account, surface it in [[../02-backend/api-routes/user]].
- **Reviews batch size + delay.** Currently 5 places per batch, 500 ms delay. Probably optimizable based on rate limit headers.
