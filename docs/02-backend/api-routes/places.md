---
title: Places routes
type: route-group
domain: backend
version: 1.6.0
last_updated: 16.07.2026
status: stable
sources:
  - src/lib/places/query-places.ts
  - src/lib/places/open-now.ts
  - src/app/api/places/route.ts
  - src/app/api/places/[id]/route.ts
  - src/app/api/places/[id]/enrich/route.ts
  - src/app/api/places/[id]/refresh-google-data/route.ts
  - src/app/api/places/bulk/route.ts
  - src/app/api/places/bulk-enrich-reviews/route.ts
  - src/app/api/places/import-parse/route.ts
  - src/app/api/places/import-batch/route.ts
  - src/app/api/places/migrate-photos/route.ts
  - src/app/api/places/parse-link/route.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/places]]"
  - "[[../schema/places]]"
  - "[[../../04-integrations/google-places]]"
  - "[[../../04-integrations/dataforseo]]"
---

# Places routes

> **Telemetry (v1.16.0):** `enrich?step=profile` stamps Langfuse trace fields (`place-profile`) around `generatePlaceProfile` and flushes via `after(flushLangfuse)`. See [[../../05-flows/observability-flow]].

Ten route handler files under `/api/places/*`. The Place is the most-touched entity in the schema; this is the busiest part of the API.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/places` | Filter/search/sort the user's places. |
| `POST` | `/api/places` | Create a place (manual, share-target, parse-link). |
| `GET` | `/api/places/[id]` | Detail with tags, lists, photos, trip refs. |
| `PATCH` | `/api/places/[id]` | Partial update + tag/list sync. |
| `DELETE` | `/api/places/[id]` | Delete with cascade across junctions. |
| `POST` | `/api/places/[id]/enrich` | Re-run enrichment (`step=info` or `step=reviews`). |
| `POST` | `/api/places/[id]/refresh-google-data` | Full re-fetch: info + `newest` reviews merged into the corpus (not replace) + photo, then chains to `step=profile`. Core logic in `src/lib/places/refresh-google-data.ts` (shared with the cron). |
| `POST` | `/api/places/bulk` | Bulk update_category / add_tags / add_to_list / update_status / delete / check_trips. |
| `POST` | `/api/places/bulk-enrich-reviews` | Background bulk review enrichment. |
| `POST` | `/api/places/import-parse` | Parse a Takeout file → place list (no insert). |
| `POST` | `/api/places/import-batch` | Enrich + insert a small batch (~3 places). |
| `POST` | `/api/places/migrate-photos` | Backfill: Google photo URLs → Supabase Storage. |
| `POST` | `/api/places/parse-link` | Google Maps URL → place data preview. |

All require auth.

---

## Per-route detail

### `GET /api/places`

> **v1.21.0:** the query engine moved verbatim to `src/lib/places/query-places.ts` (`queryPlaces(supabase, userId, filters)`) so the assistant's `search_places` tool shares it; this handler is now a thin param-mapping shell. Everything below still describes the behaviour — it just lives in the lib file.

- **Source:** `src/app/api/places/route.ts`
- **Auth:** required.
- **Query params:**
  - `country` (string), `city` (string)
  - `category` (CSV of category IDs)
  - `tags` (CSV of tag IDs)
  - `list` (single list ID)
  - `status` (one of `want_to_go` / `booked` / `visited` / `favorite`)
  - `rating` (min user rating)
  - `google_rating` (min Google rating)
  - `q` (search text — ILIKE over `name`, `address`, `notes`, and since 15.07.2026 also `place_profile.searchable_summary` + `tldr`; `%`/`,` escaped)
  - `sort` (`newest` / `oldest` / `name_asc` / `name_desc` / `rating_desc` / `google_rating_desc`)
- **DB:** `places` SELECT, joins to `categories`; secondary in-memory filtering for tags and lists (via `place_tags` / `list_places` lookups).
- **Response:** `Place[]` with `location` parsed to `{ lat, lng }`. `200`.
- **Notes:** Tag/list filters applied post-query in JS. `google_rating_desc` sort happens post-fetch (JSONB sort).
- **`ids`** (v1.19.0, compare view): CSV of place ids (cap 10) → `.in("id", ids)`. Deliberately on the LIST route — it has the EWKB-safe location parser + subcategory join the `[id]` route lacks.
- **`open_now=true`** (v1.18.0): dynamic filter — JS post-filter evaluating `isOpenNow(google_data.work_timetable, google_data.tz)` at request time in the place's local timezone (`src/lib/places/open-now.ts`). Places without timetable/tz are EXCLUDED (unknown ≠ open). The same module also exports `isOpenOnDate(timetable, isoDate)` (v1.22.0) — **day-granular**, not point-in-time: "does the place open at all on this calendar date" (weekday straight from the ISO date, tz-independent; missing timetable → null = unknown ≠ closed, listed-but-empty day → false). Used by `/api/ai/trip-plan` to precompute per-trip-day open flags — not by this route group's filters.


### `POST /api/places`

- **Source:** `src/app/api/places/route.ts`
- **Auth:** required.
- **Body:** `{ name (required), lat (required), lng (required), address?, country?, city?, category_id?, rating?, notes?, google_place_id?, google_data?, source?, tag_ids?[], list_ids?[], visit_status?, photoRef? }`.
- **DB:** `places` SELECT (dup check) + INSERT, `place_tags` INSERT, `list_places` INSERT.
- **External:** `downloadAndStorePhotoFromUrl` (DataForSEO photo path) if `photoRef` is passed.
- **Response:** Created place with `location` parsed. `200`, `409` on duplicate `google_place_id`.
- **Side effects:**
  - Auto-categorizes from Google `types` if no `category_id`.
  - Sets `visited_at` / `booked_at` from `visit_status`.
  - **Strips** `reviews`, `editorialSummary`, `editorial_summary`, `photos` from inbound `google_data` before INSERT (they come later, separately).
  - Stores `location` as `POINT(lng lat)` via Supabase JS.

### `GET /api/places/[id]`

- **Source:** `src/app/api/places/[id]/route.ts`
- **Auth:** required.
- **DB:** `places` SELECT joined with `categories`; secondary fetches for `place_tags`, `list_places`, `place_photos`, and `trip_day_places` (to surface trip refs).
- **Response:** `Place` + `tags[]` + `lists[]` + `photos[]` + `trips: string[]` (trip names). `404` if not owned/found.

### `PATCH /api/places/[id]`

- **Source:** `src/app/api/places/[id]/route.ts`
- **Auth:** required + ownership check.
- **Body:** `{ name?, address?, category_id?, rating?, notes?, visit_status?, tag_ids?[], list_ids?[] }` — all optional.
- **DB:** `places` UPDATE; `place_tags` DELETE+INSERT for sync; `list_places` DELETE+INSERT for sync.
- **Side effects:**
  - `updated_at` bumped.
  - `visit_status` transitions: sets `visited_at` / `booked_at` if newly visited/booked; clears both if reset to `want_to_go`.

### `DELETE /api/places/[id]`

- **Source:** `src/app/api/places/[id]/route.ts`
- **Auth:** required + ownership.
- **DB:** `places` DELETE → cascades to `place_tags`, `place_photos`, `list_places`, and **`trip_day_places`** (CASCADE on `place_id`).
- **Notes:** Trip references vanish silently. The bulk-delete flow runs `check_trips` first to warn the user.

### `POST /api/places/[id]/enrich?step=info|reviews`

- **Source:** `src/app/api/places/[id]/enrich/route.ts`
- **Query:** `step` = `info` or `reviews`.
- **Body (reviews):** optional `{ cid: string }`.
- **DB:** `places` SELECT + UPDATE.
- **External:** DataForSEO `fetchBusinessInfoLive` / `fetchReviews`; `downloadAndStorePhotoFromUrl`; `trackUsage`.
- **Response:**
  - `info`: `{ ok, cid? }`
  - `reviews`: `{ ok, reviews: number }`
- **Notes:** `step=info` (~3–4 s, awaited by client). `step=reviews` (~30 s, fire-and-forget). `cid` source: body (Google path) or existing `google_data.cid` (DataForSEO).

### `POST /api/places/[id]/refresh-google-data`

- **Source:** `src/app/api/places/[id]/refresh-google-data/route.ts`
- **Auth:** required.
- **DB:** `places` SELECT + UPDATE.
- **External:** DataForSEO business-info + reviews in one call, photo download, `trackUsage`.
- **Response:** Updated `Place`. `400` if missing `google_place_id`.
- **Notes:** All-in-one refresh replacing `info` + `reviews`. Strips legacy `photos` / `editorial_summary` fields.

### `POST /api/places/bulk`

- **Source:** `src/app/api/places/bulk/route.ts`
- **Auth:** required; verifies every `place_id` is owned by user.
- **Body:** `{ action, place_ids: string[], ... }`. Actions:
  - `update_category` — `{ category_id }`
  - `add_tags` — `{ tag_ids[] }` (UPSERT into `place_tags`)
  - `add_to_list` — `{ list_id }` (UPSERT into `list_places`)
  - `update_status` — `{ visit_status }` (+ timestamp side effects)
  - `delete` — bulk DELETE
  - `check_trips` — read-only, returns `{ affected: 0, tripNames: string[], placesInTrips: number }`
- **DB:** varies by action — `places`, `place_tags`, `list_places`, `trip_day_places` (read for `check_trips`).
- **Response:** `{ success: true, affected: number }` (or `check_trips` shape).

### `POST /api/places/bulk-enrich-reviews`

- **Source:** `src/app/api/places/bulk-enrich-reviews/route.ts`
- **Body:** `{ placeIds: string[] }`.
- **DB:** `places` SELECT + UPDATE.
- **External:** DataForSEO `fetchReviews`, `transformReviews`, `trackUsage`. 500 ms delay between places.
- **Response:** `{ enriched, failed, total }`.
- **Notes:** Fire-and-forget. Skips places missing `google_data.cid`. Per-place errors silently increment `failed`.

### `POST /api/places/import-parse`

- **Source:** `src/app/api/places/import-parse/route.ts`
- **Body:** multipart `file`.
- **DB:** none (parse-only).
- **Response:** `{ places: ParsedPlaceData[], total: number }`. `200`, `400` on parse error.
- **Notes:** Synchronous, fast. Pure parse — no enrichment, no DB writes. Drives the client-side batched import flow.

### `POST /api/places/import-batch`

- **Source:** `src/app/api/places/import-batch/route.ts`
- **Body:** `{ places: ParsedPlaceData[], visit_status?, list_ids?[], tag_ids?[] }`.
- **DB:** `categories` SELECT; `places` SELECT (dup) / INSERT / UPDATE; `list_places` INSERT; `place_tags` INSERT.
- **External:** DataForSEO business-info, transforms, photo download, `trackUsage`. `parseMapsUrl` for URL parsing where applicable.
- **Response:** `{ results: [{ name, status: "enriched"|"imported"|"skipped", reason?, placeId? }] }`.
- **Notes:** Called in a client loop of batch size 3. Per-place error handling with reasons; ownership-safe.

### `POST /api/places/migrate-photos`

- **Source:** `src/app/api/places/migrate-photos/route.ts`
- **DB:** `places` SELECT + UPDATE.
- **External:** `fetch` Google photo URLs, Supabase Storage upload + `getPublicUrl`.
- **Response:** `{ total, migrated, failed, skipped }`.
- **Notes:** Idempotent. Filters `places` where `google_data.photos[0]` exists but `photo_storage_url` is missing. 300 ms between places to be polite. Removes the legacy `photos[]` array after success.

### `POST /api/places/parse-link`

- **Source:** `src/app/api/places/parse-link/route.ts`
- **Body:** `{ url: string }`.
- **DB:** `profiles` SELECT (via `getUserApiKeys`).
- **External:** `parseMapsUrl`; Google Places (`getPlaceDetails` / `searchPlace`) when enabled + keyed; DataForSEO `fetchBusinessInfoLive` fallback; Mapbox `reverseGeocode` (for short-query padding); transforms; `trackUsage`.
- **Response:** Place data + `_provider: "google"|"dataforseo"`, `_fetchTimeMs`, optional `_extended` (DataForSEO), optional `lite_profile: PlaceProfile | null` (Phase 3+). `200` / `400` (invalid URL, no credentials, no results) / `404`.
- **lite_profile (Phase 3):** Inline rule-based profile (no LLM call). Built by `buildLiteProfileForResponse` after the main fetch, gated by `profiles.ai_features_enabled`. Carries `category_signals` (primary + sub-category slug + confidence), `features` (cuisine/dietary/seating/distinctive/price_range — atmosphere/occasions/music/crowd left empty for Phase 4), `suggested_tags.matched_existing` (no new_proposals in lite path), and `suggested_lists` (city/country/category/cuisine fuzzy match). Fail-soft: any error logs and returns `lite_profile: null` rather than failing the parse. See [[../../05-flows/lite-profile-flow]].
- **DataForSEO keyword branching** (in order of preference):
  - `cidFromUrl` (raw URL has `?cid=` or FTid) → `keyword: cid:<decimal>`.
  - `parsed.type === "cid"` (parser extracted CID from FTid's second hex) → `keyword: cid:<decimal>` — exact match, bypasses text search.
  - `parsed.type === "place_id"` → `keyword: place_id:ChIJ...`.
  - `parsed.type === "search"` with coords → **reverse-geocodes via Mapbox** to fetch `full_address`, appends to keyword (`"<query>, <full_address>"`), widens coord bias to 2 km. Without the address suffix Google's text-search loses bare names (`"Beam"`) against global namesakes.
  - Bare `lat/lng` → `keyword: "lat,lng"` + 200 m bias (weakest fallback).
- **Notes:** Dual-path resolution. `photoRef` deferred to a later enrichment step.

## Cross-route concerns

- **Dedup by `google_place_id`.** Every insert path checks the user's existing places by `google_place_id` before inserting. If the key is missing (DataForSEO without Google ID, manual entry), no dedup.
- **`google_data` size discipline.** Inbound payloads are stripped of bulky fields (`reviews`, `editorialSummary`, `editorial_summary`, `photos`) before INSERT. These come back later via enrichment.
- **Photo strategy.** Whatever creates the place schedules the photo download into Supabase Storage; the URL is stored in `google_data.photo_storage_url`. No `place_photos` row is created today (table is dormant — see [[../schema/place_photos]]).
- **Visit-status timestamps.** Application-managed: `visited_at` set when status flips to `visited`; `booked_at` when flipped to `booked`; both cleared when reset to `want_to_go`.

## Open questions

- **Bulk operations atomicity.** `bulk` actions run as a sequence of Supabase calls. A partial failure leaves the system in a half-applied state. A stored proc per action would close that gap.
