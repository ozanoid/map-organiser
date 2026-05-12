---
title: trip_days
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
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

One row per calendar date inside a trip. 33 rows in snapshot (5 trips × avg ~6 days).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `trip_id` | uuid | no | — | FK → `trips.id` (CASCADE on parent delete). |
| `day_number` | int | no | — | 1-indexed sequential position within the trip. |
| `date` | date | no | — | Concrete calendar date. Should equal `trip.start_date + (day_number - 1)`. |
| `notes` | text | yes | — | Day-level notes. |
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

- **Migration.** `create_trip_days_table` (2026-04-15).
- **Day-number unique within trip.** Not enforced by DB constraint — app discipline. Adding `UNIQUE (trip_id, day_number)` would catch bugs.
- **`day_number` + `date` move in lock-step.** `POST /api/trips/[id]/swap-days` swaps both columns to keep position-vs-calendar mapping consistent.
- Consumed by: `/api/trips/[id]` (joined detail), `/api/trips/[id]/swap-days`, `/api/trips/[id]/auto-plan`, `/api/trips/[id]/days/[dayId]/...` routes, `/api/shared/[slug]` (trip share view).

## Open questions

- **No CHECK on date range.** A `day_number` of 0 or a date outside `trip.start_date..end_date` is technically possible. Worth a CHECK or trigger.
