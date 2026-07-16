---
title: trip_day_places
type: table
domain: backend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[trip_days]]"
  - "[[trips]]"
  - "[[places]]"
  - "[[../../01-domain/trips]]"
---

# `trip_day_places`

> **v1.22.0 (NF-08/AI-09):** new `cost_estimate` + `currency` columns (migration `add_trip_day_places_cost_columns`) — per-person budget estimates, seeded from `google_data.price_level` on insert and inline-editable in the trip UI. `time_slot` and `notes` gained their first UI render + a structured writer: the AI trip planner (`POST /api/ai/trip-plan`) sets `time_slot` (morning/afternoon/evening/night) and an optional per-stop note. All delete+insert rewrite paths (move, auto-plan, AI plan) now carry these row fields — before v1.22.0 they were silently destroyed.

Places placed within a trip day, ordered. The most active row count in the trip-planning model (102 rows in snapshot).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `trip_day_id` | uuid | no | — | FK → `trip_days.id` (CASCADE). |
| `place_id` | uuid | no | — | FK → `places.id` (**CASCADE** — migration `add_cascade_delete_trip_day_places_place_id`). |
| `sort_order` | int | yes | `0` | Within-day order. |
| `time_slot` | text | yes | — | Free-form (e.g. `"morning"`, `"14:00"`). Not constrained by the DB; the AI planner writes one of morning/afternoon/evening/night. |
| `notes` | text | yes | — | Per-stop notes. AI planner writes an optional one-line reason here. |
| `cost_estimate` | numeric | yes | — | v1.22.0 (NF-08). **Per-person** cost estimate. Seeded on insert from `google_data.price_level` via `defaultCostEstimate` (`src/lib/trip/cost-defaults.ts`: 1→$10, 2→$25, 3→$50, 4→$90); null when no price_level. Inline-editable (CostBadge). API clamps to 0–100000. |
| `currency` | text | yes | `'USD'` | v1.22.0 (NF-08). Currency code for `cost_estimate`. Conversion deferred to v2 — defaults are flat USD. |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `trip_day_places_pkey` | `id` | btree UNIQUE | Primary key. |

No indexes on `trip_day_id` or `place_id` directly — sequential scans are fine at current scale. As rows grow, add:

- `CREATE INDEX idx_tdp_trip_day ON trip_day_places (trip_day_id, sort_order)` — for "places of this day, ordered".
- `CREATE INDEX idx_tdp_place ON trip_day_places (place_id)` — for "trips referencing this place" (used by `check_trips`).

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users can manage own trip day places | ALL | public | `trip_day_id IN (SELECT td.id FROM trip_days td JOIN trips t ON t.id = td.trip_id WHERE t.user_id = auth.uid())` |

**Two-level ownership walk** — `trip_day_places.trip_day_id` → `trip_days.trip_id` → `trips.user_id`. Most expensive RLS predicate in the schema; worth keeping the indexes on `trip_days.trip_id` and `trips.id` healthy.

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `trip_day_id` | `trip_days.id` | CASCADE |
| `place_id` | `places.id` | **CASCADE** |

The CASCADE on `place_id` is the reason `places` bulk-delete runs `check_trips` first — silently losing trip places is a real risk if the user doesn't realize the place is referenced.

## Notes

- **Migration.** `create_trip_day_places_table` (2026-04-15), `add_cascade_delete_trip_day_places_place_id` (2026-04-15), `add_trip_day_places_cost_columns` (2026-07-16, v1.22.0).
- **Adding a place.** `POST /api/trips/[id]/days/[dayId]/places` inserts with `sort_order = MAX(sort_order) + 1` and seeds `cost_estimate` from the place's `price_level` (v1.22.0).
- **Reordering.** `PATCH /api/trips/[id]/days/[dayId]/reorder` rewrites `sort_order` for each place by index (0-based).
- **Moving between days.** `PATCH /api/trips/[id]/days/[dayId]/places` (move shape: `{ place_id, target_day_id }`) is a DELETE + INSERT — not an UPDATE — so the moved row gets a new `id`. Since v1.22.0 the route snapshots `cost_estimate/currency/time_slot/notes` before the delete and carries them into the insert (they were silently dropped before).
- **In-place update.** The same PATCH route accepts a second shape (v1.22.0): `{ place_id, cost_estimate? | time_slot? | notes? }` → plain UPDATE, id unchanged.
- **Auto-plan is destructive but field-preserving.** `POST /api/trips/[id]/auto-plan` DELETEs all rows for the trip and re-INSERTs them according to the algorithm output; since v1.22.0 it snapshots and carries `cost_estimate/currency/time_slot/notes` by `place_id`. Same pattern in `/api/ai/trip-plan` (delete-after-validate; costs carried by `place_id`, pool entrants get price_level defaults).
- **Public share strips budget fields.** `/api/shared/[slug]` (trip path) removes `cost_estimate`/`currency` from each row before responding — owner-private planning data (v1.22.0).
- Consumed by: every trip-day API route, `/api/ai/trip-plan` (full rewrite), `/api/places/bulk` (`check_trips` action), `/api/shared/[slug]` (trip share view).

## Open questions

- **No UNIQUE constraint on `(trip_day_id, place_id)`.** A place can theoretically appear twice in the same day. The app prevents this in code but a DB constraint would be safer.
- **`time_slot` enum vs free-form.** The AI planner (v1.22.0) writes the 4-value set morning/afternoon/evening/night, but the column and the manual-update PATCH remain free-form text. If manual editing consolidates to the same set, worth a CHECK constraint.
