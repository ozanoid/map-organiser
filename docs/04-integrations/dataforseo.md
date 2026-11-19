---
title: DataForSEO Business Data
type: integration
domain: integrations
version: 1.7.2
last_updated: 19.11.2026
status: stable
sources:
  - src/lib/instagram/places.ts
  - src/lib/dataforseo/
  - src/lib/place-search/
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
| `business-info.ts` | `fetchBusinessInfoLive(query, { signal, throwOnError })` — the main endpoint. Returns the full business profile, or `null`. By default `null` covers both "no such business" and a failed request; with `throwOnError` a failure throws, so `null` means only "no such business". `LIVE_LOOKUP_TIMEOUT_MS` (35 s) bounds a lookup made inside a request (`add_places`, parse-link). |
| `reviews.ts` | `fetchReviews({cid, depth, sort_by})` — reviews endpoint. Default sort `relevant` (initial/import — establishes the relevance backbone); refreshes pass `newest` to discover new reviews. |
| `transform.ts` | `transformBusinessInfoToPlaceData(response)` → `ParsedPlaceData`. |
| `category-adapter.ts` | DataForSEO category string → one of our 12 default categories. |
| `opening-hours-adapter.ts` | DataForSEO `work_time` → `weekday_text[]` + `open_now`. |
| `price-level-adapter.ts` | DataForSEO `price_level` → numeric 0–4. |
| `photo.ts` | `downloadAndStorePhotoFromUrl(url, ...)` → uploads to Supabase Storage. |

### Google Maps search (SERP API) — 18.11.2026

`src/lib/place-search/dataforseo-maps.ts` calls a second DataForSEO product, the SERP API: `POST /v3/serp/google/maps/live/advanced` with `keyword`, `location_coordinate` (`lat,lng,<zoom>z` — zoom derived from the wanted radius) and `depth`. It is the provider behind the `PlaceSearch` interface (`src/lib/place-search/`), used by the assistant's `search_google_maps` tool ([[claude-mcp]]) and, since v1.42.0, by the Instagram import's candidate search and area lookups (`src/lib/instagram/places.ts`, replacing Google Text Search).

- Each `maps_search` item carries `title`, `address`, `cid`, `place_id`, coordinates, `rating.value` / `rating.votes_count`, `category`, `phone`, `url`, `work_hours.current_status`. `price_level` came back null in every live result checked.
- The `cid` equals the one Business Info stores in `google_data.cid` (checked on a saved place), so results can be matched against the library and fed to the import pipeline.
- $0.002 per search of up to 100 results (the response's `cost` field); latency 2.6–12.4 s in six live calls.
- `client.ts` gained `dataForSeoClientFromEnv()` and an optional abort signal on `post`.
- **An area query answers with the area** (v1.42.0, measured): "Moda, Istanbul" → one item titled "Moda", no `category`, `address_info` `{ borough: Caferağa, city: Kadıköy, region: İstanbul }`; "Kadıköy, Istanbul" → `{ city: Kadıköy, region: İstanbul }`. A business always has a category. The Instagram import reads an area this way and sizes it from `address_info` (`areaReach`). Each item's `address_info` is passed on as `FoundPlace.addressParts`.
- **It needs a point.** A world-scale viewport (`20,0,3z`) returns no items, so a query without coordinates is searched around its city (Mapbox finds the city's centre).
- **No match is an answer, not an error** (v1.42.0): DataForSEO marks it with task status 40102 "No Search Results", and `search` returns an empty list — it threw before, and two Instagram eval posts failed on it. In production on 19.11.2026 the connector's `search_google_maps` gave an empty list for a nonsense query at an empty spot.

## Where it's used

| Caller | Purpose |
|---|---|
| `/api/places/parse-link` | The Add Place link preview — the only provider since v1.42.0 (the Google path for keyed users was removed). |
| Instagram import (`analyzeInstagramPost`) | Google Maps search for every venue's candidates and for the post's neighbourhood or district (`dataforseo_maps_search`, v1.42.0 — was Google Text Search). |
| `/api/cron/drain-imports` (`import` stage) | **Primary path for bulk import** — Takeout files and, since v1.28.0, the places an Instagram post adds (their payload URL is `https://maps.google.com/?cid=…`, so the lookup is an exact `cid:` keyword — or `?q=place_id:…` → `place_id:` when Google returned no CID). Every place goes through DataForSEO — unless the duplicate pre-check matched it first, which costs nothing. |
| `/api/places/[id]/enrich?step=info` | Re-enrich a single place's business info. |
| `/api/places/[id]/enrich?step=reviews` | Fetch reviews for a place. |
| `/api/places/[id]/refresh-google-data` | Full re-lookup: info + `newest` reviews **merged** into the corpus (`mergeReviews`, not replace) + chains to `step=profile`. Also runs headless in the cron. |
| `/api/cron/drain-imports` (`reviews` stage) | Bulk review enrichment for imported places (depth=50). |

## SKUs tracked

- `dataforseo_business_info_live` — Business Info Live calls.
- `dataforseo_reviews` — Reviews calls.
- `dataforseo_maps_search` — Google Maps searches: the assistant's `search_google_maps` tool (18.11.2026) and the Instagram import's candidate and area searches (v1.42.0). $2 per 1,000.

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
- **No match:** task status 40102 "No Search Results" — for Business Info, no such business (billed like a hit, $0.0054; measured 18.11.2026); for a Maps search, nothing matched (an empty list, see above). Parse-link returns 404, and 502 for a failed lookup (`throwOnError`, v1.42.2 — before, a failure was a 404 too). The import retries by name around the saved coordinate, then keeps a thin record (name and coordinate); the assistant's `add_places` saves nothing (`not_found`) and tells a failed lookup apart (`failed`).
- **Timeout:** the `_Live` endpoints are synchronous and can be slow (~3-4s per call). The 60s Vercel Function default is the hard cap; if we hit it, batch sizes need to shrink.

## Per-user opt-out

There isn't one. DataForSEO is the system-wide provider for every place lookup — the Google Places toggle and keys were removed in v1.42.0.

## Replacement strategy

If we drop DataForSEO:

- Bulk import and the Instagram import would need Google Places again — Text Search is $35 per 1,000 past 1,000 free a month, the reason it was replaced (v1.42.0).
- Reviews specifically are tricky — Google Place Details returns reviews but is expensive.
- Alternative providers: HERE, Foursquare/Places, SerpAPI. None are drop-ins; each has its own data shape and pricing.

## Open questions

- **Per-user DataForSEO billing.** Schema columns exist but no API. If we ever want users to bring their own DataForSEO account, surface it in [[../02-backend/api-routes/user]].
- **Reviews batch size + delay.** Currently 5 places per batch, 500 ms delay. Probably optimizable based on rate limit headers.
