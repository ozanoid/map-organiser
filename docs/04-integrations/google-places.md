---
title: Google Places API
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/google/places-api.ts
  - src/lib/google/parse-maps-url.ts
  - src/lib/google/category-mapping.ts
  - src/lib/google/takeout-parser.ts
  - src/lib/google/track-usage.ts
  - src/lib/google/get-user-api-keys.ts
related:
  - "[[../01-domain/places]]"
  - "[[dataforseo]]"
  - "[[../02-backend/schema/api_usage]]"
  - "[[../02-backend/api-routes/places]]"
---

# Google Places API

The original enrichment provider. Used **only when**:

1. The user has provided a personal API key (stored as `profiles.google_api_key_enc`), AND
2. `profiles.google_places_enabled = true`.

Otherwise the app falls back to [[dataforseo|DataForSEO]].

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
| `parse-maps-url.ts` | Parses Google Maps URLs into `ParsedPlaceData`. Tries explicit coords, then FTid S2 decode, then search by name. |
| `category-mapping.ts` | Maps Google `types` strings to one of our 12 default categories. |
| `takeout-parser.ts` | Parses Google Takeout JSON / CSV exports of saved places. |
| `track-usage.ts` | Calls `increment_api_usage` RPC per API call. |
| `get-user-api-keys.ts` | Decrypts the user's stored keys from `profiles`. |

## Where it's used

| Caller | Endpoint | Purpose |
|---|---|---|
| `/api/places/parse-link` | Place Details or Find Place | Primary preview path when Google is enabled. |
| `/api/places/import` (legacy NDJSON) | optional | Currently routes through DataForSEO; Google path is dormant for bulk. |
| `/api/places/migrate-photos` | direct `fetch` Google photo URL | Photo downloads to Supabase Storage. |

DataForSEO has replaced Google for bulk import flow — see [[../02-backend/api-routes/places#post-apiplacesimport-batch]].

## SKUs tracked

Observed in `track-usage.ts` callers:

- `google.text_search` — Find Place / Text Search
- `google.place_details` — Place Details
- `google.place_photo` — Photo download

Each call → +1 in `api_usage` for the user's day-row. `cost_per_1k` is set per Google's price.

## Cost & limits

Google Places (current pricing — verify in GCP console):

- **Place Details:** ~$17 / 1000
- **Find Place:** ~$17 / 1000 (with Basic Data)
- **Place Photos:** ~$7 / 1000

Per-user billing: Google bills the **API key owner**, not us. We just track usage so the user can see their estimated cost in Settings → API.

## Failure modes

- **No API key:** route falls back to DataForSEO.
- **Quota exceeded / billing disabled:** 4xx response. The app surfaces this with the provider info field in the parse-link response.
- **Place not found:** Find Place returns no results — the route returns `404`. The user sees "couldn't find that place".

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
