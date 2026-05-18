---
title: places
type: table
domain: backend
version: 1.2.0
last_updated: 18.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[../../01-domain/places]]"
  - "[[../../01-domain/geo-and-s2]]"
  - "[[categories]]"
  - "[[subcategories]]"
  - "[[place_tags]]"
  - "[[list_places]]"
  - "[[place_photos]]"
  - "[[trip_day_places]]"
  - "[[ai_suggestions_queue]]"
tags:
  - core
  - geo
---

# `places`

The core entity — user-saved locations. 458 rows in the current snapshot. Geographic data in `location` (PostGIS `geography`); rich provider data in `google_data` (`jsonb`).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `google_place_id` | text | yes | — | Stable Google Places identifier; nullable when source is manual or DataForSEO. Used for dedup. |
| `name` | text | no | — | Display name. |
| `address` | text | yes | — | Free-form formatted address. |
| `country` | text | yes | — | Drives country filter pills. |
| `city` | text | yes | — | Drives city filter pills. |
| `location` | `geography` | no | — | PostGIS Point, SRID 4326. Always present. |
| `category_id` | uuid | yes | — | FK → `categories.id`. 0..1 per place. |
| `subcategory_id` | uuid | yes | — | FK → `subcategories.id` ON DELETE SET NULL. Phase 2 (`add_subcategory_id_to_places`, 13.05.2026). Set automatically by Phase 4 silent apply, Phase 5 accept, or the AddPlaceDialog lite-profile chip. |
| `rating` | smallint | yes | — | User's 1–5 rating. Check `rating >= 1 AND rating <= 5`. |
| `notes` | text | yes | — | Free-form. |
| `google_data` | jsonb | yes | `'{}'::jsonb` | Provider data (see [[../../01-domain/places#google_data-shape]]). |
| `source` | text | yes | `'manual'::text` | CHECK enum: `manual` / `import` / `link` / `mapbox_search`. Added 13.05.2026 (migration `add_source_check_with_mapbox_search`). |
| `visit_status` | text | yes | — | Check enum: `want_to_go` / `booked` / `visited` / `favorite`. |
| `visited_at` | timestamptz | yes | — | Set when status flips to `visited` (app-side). |
| `booked_at` | timestamptz | yes | — | Set when status flips to `booked` (app-side). |
| `created_at` | timestamptz | yes | `now()` | — |
| `updated_at` | timestamptz | yes | `now()` | App-managed. |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `places_pkey` | `id` | btree UNIQUE | Primary key. |
| `idx_places_user` | `user_id` | btree | RLS predicate scan. |
| `idx_places_category` | `category_id` | btree | Category filter. |
| `idx_places_country_city` | `(user_id, country, city)` | btree composite | Country/city filter and grouping. |
| `idx_places_google_id` | `(user_id, google_place_id)` | btree | Dedup checks on import/parse-link. |
| `idx_places_location` | `location` | **GIST** | Spatial queries (`ST_DWithin` and friends). |
| `idx_places_visit_status` | `(user_id, visit_status) WHERE visit_status IS NOT NULL` | btree partial | Visit-status filter. |
| `idx_places_subcategory` | `subcategory_id WHERE subcategory_id IS NOT NULL` | btree partial | Sub-category filter (Phase 2). |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own places | ALL | authenticated | `auth.uid() = user_id` (with_check identical) |

## Foreign keys

### Outgoing

| Column | References | On delete | On update |
|---|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) | — |
| `category_id` | `categories.id` | (default NO ACTION) | — |
| `subcategory_id` | `subcategories.id` | SET NULL | — |

### Incoming (other tables → `places.id`)

| Source table | Column | On delete |
|---|---|---|
| `place_tags` | `place_id` | CASCADE |
| `place_photos` | `place_id` | CASCADE |
| `list_places` | `place_id` | CASCADE |
| `trip_day_places` | `place_id` | **CASCADE** (migration `add_cascade_delete_trip_day_places_place_id`) |

When a place is deleted, all four junction/child rows go with it.

## Triggers / functions

None on this table directly.

## Notes

- **Migration history.** `create_places` (2026-04-09), `add_visit_status` (2026-04-10), `create_place_categories_junction` (2026-04-14) then `drop_place_categories_junction` (2026-04-14) — the team briefly experimented with M:N category before reverting to single-category, `add_cascade_delete_trip_day_places_place_id` (2026-04-15), `add_source_check_with_mapbox_search` (2026-05-13), `add_subcategory_id_to_places` (2026-05-13).
- **`google_data` size discipline.** API routes strip `reviews`, `editorialSummary`, `editorial_summary`, and `photos` from the inbound payload before insert. Reviews come back later via the enrichment step. Photos are replaced by `photo_storage_url` after download. This keeps the row size sane.
- **`google_data.place_profile` (Phase 4).** AI pivot data nested under `google_data`. Schema in `src/lib/ai/schemas/place-profile.ts`. Two completeness levels (`"lite"` / `"full"`). Written by `POST /api/places/[id]/enrich?step=profile`. Detail page renders via `AiSummaryCard`. See [[../../01-domain/places#google_dataplace_profile-shape-phase-4]] for the field-by-field shape.
- **`location` is canonical.** Frontend `Place.location` of type `{ lat, lng }` is the post-parser shape; raw EWKB comes back from PostgREST and is parsed by `src/lib/geo.ts#parsePostgisPoint` on every read.
- Consumed by: every `/api/places/*` route, `/api/trips/*` (via join), `/api/shared/[slug]` (via join), `/api/stats`.

## Open questions

- **`updated_at` is not enforced.** App-managed only; a missed `update` call leaves it stale. A `moddatetime` extension trigger could automate.
