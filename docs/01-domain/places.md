---
title: Place
type: entity
domain: places
version: 1.2.0
last_updated: 15.07.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/hooks/use-places.ts
  - src/lib/geo.ts
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
  - src/app/(app)/places/page.tsx
  - src/app/(app)/places/[id]/page.tsx
  - src/components/places/place-card.tsx
  - src/components/places/add-place-dialog.tsx
  - src/components/places/ai-summary-card.tsx
  - src/lib/ai/schemas/place-profile.ts
  - src/lib/ai/apply-suggestions.ts
related:
  - "[[categories-and-tags]]"
  - "[[lists]]"
  - "[[trips]]"
  - "[[sharing]]"
  - "[[geo-and-s2]]"
  - "[[users-and-profiles]]"
  - "[[../02-backend/schema/places]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/dataforseo]]"
  - "[[../04-integrations/mapbox]]"
  - "[[../04-integrations/gemini]]"
  - "[[../05-flows/lite-profile-flow]]"
  - "[[../05-flows/full-profile-flow]]"
---

# Place

A single user-saved location. The atomic unit of the app — every other entity (List, Trip, Tag, Share) ultimately points at one or more Places.

## Shape

Source of truth: `public.places` table + `Place` interface in `src/lib/types/index.ts`. The interface includes the raw row plus optional joins that hooks attach.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | Server-generated. |
| `user_id` | uuid | yes | FK → `auth.users.id`. RLS-scoped. |
| `google_place_id` | text | no | Stable Google Places identifier; nullable when source is manual or DataForSEO without Google ID. |
| `name` | text | yes | Display name. |
| `address` | text | no | Free-form formatted address. |
| `country` | text | no | Drives country filter pills. |
| `city` | text | no | Drives city filter pills. |
| `location` | `geography(Point)` | yes | PostGIS geography. Sent over the wire as EWKB hex; parsed to `{lat, lng}` via `src/lib/geo.ts#parsePostgisPoint`. |
| `category_id` | uuid | no | FK → `categories.id`. One category per place (1:1 optional). |
| `subcategory_id` | uuid | no | FK → `subcategories.id` (Phase 2). One sub-cat per place; ON DELETE SET NULL. Set by lite path auto-pre-select, by Phase 4 silent apply, or by accepting a Phase 5 moderation queue proposal. See [[categories-and-tags#sub-categories-at-a-glance]]. |
| `rating` | smallint | no | User's own 1–5 rating. Check constraint `rating >= 1 AND rating <= 5`. |
| `notes` | text | no | Free-form. |
| `google_data` | jsonb | no | Rich data from Google Places or DataForSEO (see [[#google_data shape]] below). |
| `source` | text | no | `manual` / `import` / `link`. Default `manual`. |
| `visit_status` | text | no | One of `want_to_go` / `booked` / `visited` / `favorite`. Check constraint enforces. |
| `visited_at` | timestamptz | no | Set when status transitions to `visited`. |
| `booked_at` | timestamptz | no | Set when status transitions to `booked`. |
| `created_at` | timestamptz | yes | `default now()`. |
| `updated_at` | timestamptz | yes | `default now()`. App-managed (no trigger). |

### `google_data` shape

`GooglePlaceData` in `src/lib/types/index.ts`. Loosely typed `jsonb` — fields are optional and provider-dependent.

Core (both providers):

- `types: string[]` — Google category strings.
- `photos: string[]` — original photo URLs (later replaced by `photo_storage_url` after migration).
- `photo_storage_url?: string` — Supabase Storage URL once a photo is downloaded and stored.
- `rating?: number`, `user_ratings_total?: number` — public ratings (vs the user's own `places.rating`).
- `opening_hours?: { weekday_text?: string[], open_now?: boolean }`.
- `website?: string`, `phone?: string`, `price_level?: number`, `url?: string`.
- `reviews?: GoogleReview[]` — top public reviews.

DataForSEO-only extensions (set when `provider === "dataforseo"`):

- `cid?: string` — Google CID (when known).
- `rating_distribution?: Record<string, number>` — bucketized rating histogram.
- `popular_times?: Record<string, Array<{ hour: number, popular_index: number }>>`.
- `place_topics?: Record<string, number>` — extracted topic frequencies.
- `attributes?: Record<string, boolean>` — boolean flags ("outdoor seating", etc.).
- `is_claimed?: boolean`, `current_status?: string`, `total_photos?: number`.
- `business_description?: string`, `book_online_url?: string`.
- `local_business_links?: Array<{ type, url, title? }>`.
- `people_also_search?: Array<{ title, cid?, rating? }>`.
- `enriched_at?: string` — ISO timestamp of last enrichment.

### `google_data.place_profile` shape (Phase 4)

AI pivot data attached to each place once Gemini full profile generation completes. Set by `POST /api/places/[id]/enrich?step=profile`. Two completeness levels:

- **`completeness: "lite"`** — rule-based, no LLM. Only `category_signals`, `features` (DataForSEO-derived), and `suggested_tags.matched_existing` populated. Stays in this state if AI is disabled, reviews never land, or the LLM call fails. Lite profile is NOT persisted in the schema by default — it's returned inline by `parse-link` for the dialog. Full profile overwrites with `completeness: "full"`.
- **`completeness: "full"`** — Gemini Flash output. All fields populated.

Top-level fields:
- `category_signals: { primary, primary_confidence, sub_category, sub_category_confidence, secondary_role }` — LLM's classification opinion. Apply layer compares `primary` to `places.category_id` and queues a category_change proposal if they disagree (Phase 5.5).
- `features: { cuisine_types, dietary, atmosphere, occasions, seating, music, crowd, price_range, distinctive }` — LLM-derived attributes for future filtering / RAG.
- `suggested_tags: { matched_existing: uuid[], new_proposals: string[] }` — tag UUIDs + new lowercase-hyphenated names.
- `suggested_lists: uuid[]` — list UUIDs the LLM thinks fit. **Surfaced as chips in Add dialog; never silent-applied** (see [[../05-flows/full-profile-flow#why-no-list-silent-apply]]).
- `tldr`, `pros[]`, `cons[]`, `theme_insights[]`, `searchable_summary` — content fields rendered by the AI Summary card.
- `source_review_count`, `generated_at`, `model_version` — provenance.

Schema definition: `src/lib/ai/schemas/place-profile.ts` (Zod). See [[../05-flows/full-profile-flow]] for the full lifecycle.

## Invariants

- **One owner.** A place belongs to exactly one user; no sharing of mutable state across users. Public sharing copies the place's data into the viewer's account if they save it (it does **not** create a multi-tenant ownership).
- **One category, many tags.** `category_id` is nullable but at most one. Tags are M:N via `place_tags`.
- **Rating is the user's, not Google's.** The 1–5 `rating` column is set by the user. Public/aggregate rating lives in `google_data.rating`.
- **`visit_status` controls timestamps.** Transitioning to `visited` sets `visited_at`; transitioning to `booked` sets `booked_at`. Other transitions are no-ops for those columns.
- **`location` is always present.** No place is inserted without coords (sometimes derived from S2 FTid decode when URL parsing).
- **`google_data` is opaque to RLS.** It's stored but never used in policy predicates.

## Lifecycle

```
   ┌──────────────────────────────────────────────────────────────┐
   │  Inbound sources                                              │
   │  • Manual UI (AddPlaceDialog)                                 │
   │  • PWA share_target → /api/share-target → /api/places         │
   │  • URL paste → /api/places/parse-link                         │
   │  • Bulk import: /api/places/import-parse → /import-batch loop │
   └────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Enrichment                                                   │
   │  • Google path (if profile.google_places_enabled + key)       │
   │  • DataForSEO path (default)                                  │
   │  • Photo download + Storage upload                            │
   │  • Reviews (background, batched)                              │
   └────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Organization                                                 │
   │  • category assignment                                        │
   │  • tag attach (place_tags)                                    │
   │  • list attach (list_places, with sort_order)                 │
   │  • visit status flip                                          │
   └────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Use                                                          │
   │  • appears in /map, /places, list detail, trip days, stats    │
   │  • participates in shared/<slug> if its list/trip is shared   │
   └──────────────────────────────────────────────────────────────┘
```

See [[../05-flows/place-import-flow]] (when written) for the import path, [[../05-flows/manual-place-create]] for the manual path.

## Relationships

| Other entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `user_id` FK |
| [[categories-and-tags\|Category]] | N:1 (optional) | `category_id` FK |
| [[categories-and-tags\|Tag]] | M:N | `place_tags` junction |
| [[lists\|List]] | M:N | `list_places` junction with `sort_order` |
| Place Photo | 1:N | `place_photos.place_id` (CASCADE) |
| [[trips\|Trip Day Place]] | 1:N | `trip_day_places.place_id` (CASCADE — see migration `add_cascade_delete_trip_day_places_place_id`) |

When a Place is deleted:

- `place_tags` rows are removed (cascade).
- `list_places` rows are removed (cascade).
- `place_photos` rows are removed (cascade).
- `trip_day_places` rows are removed (cascade) — meaning trip days can lose places silently. The bulk-delete API runs `check_trips` first to warn the user.

## API surface

All `/api/places/*` routes live in `src/app/api/places/`. See [[../02-backend/api-routes/places]] (when written) for full per-route detail.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/places` | List with filters (country, city, category_ids, tag_ids, list_id, rating_min, google_rating_min, visit_status, search, sort). |
| `POST` | `/api/places` | Create a single place (used by manual UI and parse-link flow). |
| `GET` | `/api/places/[id]` | Detail. |
| `PATCH` | `/api/places/[id]` | Update. |
| `DELETE` | `/api/places/[id]` | Delete (with cascade across junctions and trip_day_places). |
| `POST` | `/api/places/[id]/enrich` | Re-run enrichment (`step=info` or `step=reviews`). |
| `POST` | `/api/places/[id]/refresh-google-data` | Force re-fetch from Google. |
| `POST` | `/api/places/parse-link` | Parse a Google Maps URL → `ParsedPlaceData`. |
| `POST` | `/api/places/import-parse` | Parse a Takeout file → place list. |
| `POST` | `/api/places/import-batch` | Enrich + insert a batch of 3 places. |
| `POST` | `/api/places/bulk` | Bulk operations (delete, list assignment, tag assignment, category, visit status; `check_trips` pre-check). |
| `POST` | `/api/places/bulk-enrich-reviews` | Background bulk review enrichment (batch=5, depth=50). |
| `POST` | `/api/places/migrate-photos` | Backfill: download Google photo URLs into Supabase Storage. |

## Frontend code surface

| Concern | Files |
|---|---|
| Server-state hook | `src/lib/hooks/use-places.ts` — query key `["places", filters]`. |
| Card / detail UI | `src/components/places/place-card.tsx`, `src/app/(app)/places/[id]/page.tsx`. |
| Add / inline creators | `src/components/places/add-place-dialog.tsx`, `src/components/places/inline-{category,list,tag}-{creator,input}.tsx`. |
| Bulk action bar | `src/components/places/bulk-action-bar.tsx`. |
| Visit status toggle | `src/components/places/visit-status-toggle.tsx`. |
| Map rendering | `src/components/map/map-content.tsx` + `src/lib/map/category-icons.ts`. |

## Open questions

- **Photo migration completeness.** `place_photos` has 0 rows but `places.google_data.photo_storage_url` is the canonical photo path. Worth checking whether `place_photos` is dormant or still wired to a flow.
- **`source` enum.** Defined as text with default `'manual'`. Values observed in code: `manual`, `import`, `link`. No DB check constraint — silently accepts any text.
