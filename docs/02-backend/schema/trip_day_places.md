---
title: trip_day_places
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
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

Places placed within a trip day, ordered. The most active row count in the trip-planning model (102 rows in snapshot).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `trip_day_id` | uuid | no | — | FK → `trip_days.id` (CASCADE). |
| `place_id` | uuid | no | — | FK → `places.id` (**CASCADE** — migration `add_cascade_delete_trip_day_places_place_id`). |
| `sort_order` | int | yes | `0` | Within-day order. |
| `time_slot` | text | yes | — | Free-form (e.g. `"morning"`, `"14:00"`). Not constrained. |
| `notes` | text | yes | — | Per-stop notes. |
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

- **Migration.** `create_trip_day_places_table` (2026-04-15), `add_cascade_delete_trip_day_places_place_id` (2026-04-15).
- **Adding a place.** `POST /api/trips/[id]/days/[dayId]/places` inserts with `sort_order = MAX(sort_order) + 1`.
- **Reordering.** `PATCH /api/trips/[id]/days/[dayId]/reorder` rewrites `sort_order` for each place by index (0-based).
- **Moving between days.** `PATCH /api/trips/[id]/days/[dayId]/places` (target_day_id variant) is a DELETE + INSERT — not an UPDATE — so the moved row gets a new `id`.
- **Auto-plan is destructive.** `POST /api/trips/[id]/auto-plan` DELETEs all rows for the trip and re-INSERTs them according to the algorithm output.
- Consumed by: every trip-day API route, `/api/places/bulk` (`check_trips` action), `/api/shared/[slug]` (trip share view).

## Open questions

- **No UNIQUE constraint on `(trip_day_id, place_id)`.** A place can theoretically appear twice in the same day. The app prevents this in code but a DB constraint would be safer.
- **`time_slot` enum vs free-form.** If the UI consolidates to morning/afternoon/evening, worth a CHECK constraint.
