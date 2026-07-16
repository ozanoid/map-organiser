---
title: trip_days
type: table
domain: backend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[trips]]"
  - "[[trip_day_places]]"
  - "[[../../01-domain/trips]]"
---

# `trip_days`

> **v1.22.0 (NF-07/AI-09):** new `routing_profile` column (migration `add_trip_days_routing_profile`) — the per-day Mapbox Directions mode, switchable from the day header in the trip UI. `notes` gained its first real writer: the AI trip planner persists each day's theme + rationale there (`POST /api/ai/trip-plan`), and it's now editable via the new `PATCH /api/trips/[id]/days/[dayId]`.

One row per calendar date inside a trip. 33 rows in snapshot (5 trips × avg ~6 days).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `trip_id` | uuid | no | — | FK → `trips.id` (CASCADE on parent delete). |
| `day_number` | int | no | — | 1-indexed sequential position within the trip. |
| `date` | date | no | — | Concrete calendar date. Should equal `trip.start_date + (day_number - 1)`. |
| `notes` | text | yes | — | Day-level notes. Since v1.22.0 the AI trip planner writes `"{theme} — {rationale}"` here; rendered under the day header. |
| `routing_profile` | text | no | `'walking'` | v1.22.0 (NF-07). CHECK: `'walking'` / `'driving'` / `'cycling'`. Passed to Mapbox Directions as the profile for this day's route. Must stay in sync with the `RoutingProfile` union in `src/lib/types/index.ts`. |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `trip_days_pkey` | `id` | btree UNIQUE | Primary key. |

No index on `trip_id` directly — the FK provides one implicitly in some PostgreSQL versions, but worth verifying. RLS predicate walks `trip_id → trips.id → trips.user_id`.

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users can manage own trip days | ALL | public | `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `trip_id` | `trips.id` | CASCADE |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `trip_day_places` | `trip_day_id` | CASCADE |

## Notes

- **Migration.** `create_trip_days_table` (2026-04-15), `add_trip_days_routing_profile` (2026-07-16, v1.22.0).
- **Day-number unique within trip.** Not enforced by DB constraint — app discipline. Adding `UNIQUE (trip_id, day_number)` would catch bugs.
- **`day_number` + `date` move in lock-step.** `POST /api/trips/[id]/swap-days` swaps both columns to keep position-vs-calendar mapping consistent.
- **Updating a single day.** `PATCH /api/trips/[id]/days/[dayId]` (v1.22.0) — Zod-whitelisted to `routing_profile` + `notes`, with a two-level ownership check (trip → user before the day UPDATE).
- Consumed by: `/api/trips/[id]` (joined detail; reads `routing_profile` per day for `getRoute`), `/api/trips/[id]/swap-days`, `/api/trips/[id]/auto-plan`, `/api/trips/[id]/days/[dayId]` (PATCH, v1.22.0), `/api/trips/[id]/days/[dayId]/...` routes, `/api/ai/trip-plan` (writes `notes`), `/api/shared/[slug]` (trip share view; honours `routing_profile`).

## Open questions

- **No CHECK on date range.** A `day_number` of 0 or a date outside `trip.start_date..end_date` is technically possible. Worth a CHECK or trigger.
