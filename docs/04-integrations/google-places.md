---
title: Google Places API
type: integration
domain: integrations
version: 1.2.1
last_updated: 16.10.2026
status: stable
sources:
  - src/lib/google/places-api.ts
  - src/lib/google/parse-maps-url.ts
  - src/lib/google/category-mapping.ts
  - src/lib/google/takeout-parser.ts
  - src/lib/google/track-usage.ts
  - src/lib/google/get-user-api-keys.ts
  - src/lib/google/place-candidates.ts
  - src/lib/instagram/analyze.ts
related:
  - "[[../01-domain/places]]"
  - "[[dataforseo]]"
  - "[[../02-backend/schema/api_usage]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../05-flows/instagram-import-flow]]"
---

# Google Places API

The original enrichment provider. Used **only when**:

1. The user has provided a personal API key (stored as `profiles.google_api_key_enc`), AND
2. `profiles.google_places_enabled = true`.

Otherwise the app falls back to [[dataforseo|DataForSEO]].

**Exception — the Instagram import (v1.28.0).** Its candidate search always uses
Google Text Search on the key `getUserApiKeys` returns (the user's own, or
`GOOGLE_PLACES_API_KEY` for an admin). `google_places_enabled` is not consulted —
the owner's decision (16.10.2026): the toggle keeps scoping Maps-link lookups,
and the import's evidence rules were measured on Google results. Without a key
the import refuses to start (400). See
[[../05-flows/instagram-import-flow]].

## Account & access

- **Provider:** Google Cloud Platform → Places API.
- **Per-user keys.** Each user can set their own key in Settings → API. The repo doesn't ship a system key.
- **Admin convenience key:** `GOOGLE_PLACES_API_KEY` env var can be a system-level key, but the typical user runs on their own.
- **Auth:** API key in the URL query string.

## NPM packages

None directly — calls are `fetch` from server-side.

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | **server only** | Fallback / admin convenience key when no per-user key is set |

The encrypted per-user key lives in `profiles.google_api_key_enc` and is decrypted by `getUserApiKeys` on demand.

## What we call

Implementations in `src/lib/google/`:

| File | Purpose |
|---|---|
| `places-api.ts` | `getPlaceDetails(placeId, key)`, `searchPlace(query, key)` — Place Details + Find Place wrappers. |
| `place-candidates.ts` | `searchPlaceCandidates(query, key)` (v1.28.0) — Places API (New) `places:searchText` returning **several** candidates (5 by default, up to the query's `pageSize`), with an optional location-bias circle. Its field mask (`id, displayName, formattedAddress, location, types, businessStatus, websiteUri, nationalPhoneNumber, internationalPhoneNumber, googleMapsUri, userRatingCount, rating`) carries the website and phone the Instagram import uses as evidence; the CID is read out of `googleMapsUri`. 15 s timeout, no retry; a non-2xx throws. |
| `parse-maps-url.ts` | Parses Google Maps URLs into `ParsedPlaceData`. Tries explicit coords, then FTid S2 decode, then search by name. |
| `category-mapping.ts` | Maps Google `types` strings to one of our 12 default categories. |
| `takeout-parser.ts` | Parses Google Takeout JSON / CSV exports of saved places. |
| `track-usage.ts` | Calls `increment_api_usage` RPC per API call. |
| `get-user-api-keys.ts` | Decrypts the user's stored keys from `profiles`. |

## Where it's used

| Caller | Endpoint | Purpose |
|---|---|---|
| `/api/places/parse-link` | Place Details or Find Place | Primary preview path when Google is enabled. |
| `/api/places/migrate-photos` | direct `fetch` Google photo URL | Photo downloads to Supabase Storage. |
| Instagram import (`analyzeInstagramPost`, run by `POST /api/instagram/import` in `after()`) | Text Search (New), Enterprise field mask | Candidate places for each venue in a post, plus one geocode per verified area hint. ≈ 3 searches per post on the eval set (110 for 35 posts). A venue it skips keeps up to 20 of the candidates these searches already returned as the dialog's branch-picker options (v1.28.1) — no extra request; a picked place is then added by the import queue (DataForSEO `cid:` lookup), not by Google. |

DataForSEO has replaced Google for bulk import flow — see [[../05-flows/place-import-flow]].

## SKUs tracked

Keys of `SKU_CONFIG` in `track-usage.ts` (full list: [[../02-backend/schema/api_usage]]):

- `text_search_pro` — Find Place / Text Search ($17/1k, 5k free)
- `place_details_pro` — Place Details ($17/1k, 5k free)
- `reviews_enterprise` — Reviews ($20/1k, 1k free)
- `photos` — Photo download ($7/1k, 1k free)
- `text_search_enterprise` — Text Search with website/phone fields, the Instagram import ($35/1k, 1k free; v1.28.0)

Each call → +1 in `api_usage` for the user's day-row. `cost_per_1k` is set per Google's price.

## Cost & limits

Google Places (current pricing — verify in GCP console):

- **Place Details:** ~$17 / 1000
- **Find Place:** ~$17 / 1000 (with Basic Data)
- **Place Photos:** ~$7 / 1000
- **Text Search, Enterprise fields** (`websiteUri`, phone numbers): $35 / 1000 after 1,000 free a month, as priced in `SKU_CONFIG.text_search_enterprise`. Asking for those fields is what moves a Text Search request onto this SKU.

Per-user billing: Google bills the **API key owner**, not us. We just track usage so the user can see their estimated cost in Settings → API.

## Failure modes

- **No API key:** route falls back to DataForSEO.
- **Quota exceeded / billing disabled:** 4xx response. The app surfaces this with the provider info field in the parse-link response.
- **Place not found:** Find Place returns no results — the route returns `404`. The user sees "couldn't find that place".
- **Instagram import:** a failing Text Search (bad key, quota, billing) throws inside the background job, which ends with `service_error` ("Something went wrong while reading this post."); an empty result only means fewer candidates.

## Per-user opt-out

`profiles.google_places_enabled` flag. If `false`, the parse path skips Google entirely even if a key is configured. Useful when:

- The user wants to save Google API budget.
- DataForSEO returns better results for the user's region (varies by country).

## Replacement strategy

If we drop Google entirely:

- All parse / import paths route through DataForSEO (already the bulk path).
- Photo migration becomes harder — Google photos require Place Photos API; DataForSEO doesn't have an equivalent. We'd lose the ability to download Google photos to Storage.
- Category mapping via `types` would need an alternative source — DataForSEO categories or a generic mapping.

Migrating away is feasible but loses some quality. Recommended only if Google's pricing or T&Cs become unfriendly.
