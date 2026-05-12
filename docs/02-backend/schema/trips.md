---
title: trips
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
  - "[[trip_day_places]]"
  - "[[lists]]"
  - "[[../../01-domain/trips]]"
---

# `trips`

Multi-day trip plans. 5 rows in snapshot. Each trip materializes one `trip_days` row per calendar date.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `list_id` | uuid | yes | — | FK → `lists.id`. Optional source list. |
| `name` | text | no | — | — |
| `start_date` | date | no | — | Inclusive. |
| `end_date` | date | no | — | Inclusive. Day count = `end_date - start_date + 1`. |
| `color` | text | yes | `'#059669'` | Hex; default emerald. Trip badge color. |
| `notes` | text | yes | — | Free-form. |
| `created_at` | timestamptz | yes | `now()` | — |
| `updated_at` | timestamptz | yes | `now()` | App-managed. |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `trips_pkey` | `id` | btree UNIQUE | Primary key. |

No `idx_trips_user`. Sequential scan is fine at 5 rows but worth adding before this grows. RLS predicate (`auth.uid() = user_id`) reads `user_id` on every row.

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users can manage own trips | ALL | public | `auth.uid() = user_id` |

(Role is `public`, not `authenticated` — see [[../rls-policies#the-public-role-anomaly]]; semantically equivalent here because the predicate gates correctly.)

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |
| `list_id` | `lists.id` | (NO ACTION — list deletion orphans trip's back-link) |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `trip_days` | `trip_id` | CASCADE |

## Notes

- **Migration.** `create_trips_table` (2026-04-15).
- **Day materialization on create.** `POST /api/trips` calculates `end_date - start_date + 1` days and INSERTs that many `trip_days` rows in one go.
- **Day-count + place-count are computed, not stored.** Both come back as derived fields from the API joins.
- Consumed by: every `/api/trips/*` route, `/api/shared/[slug]` (when `resource_type = 'trip'`), `/api/places/bulk` `check_trips` action (to warn before bulk-delete).

## Open questions

- **`idx_trips_user`.** Add `CREATE INDEX idx_trips_user ON public.trips (user_id)` once row count grows past a few hundred.
- **Auto-`updated_at`.** Like other tables in the repo, `updated_at` is app-managed. Wire a `moddatetime` trigger for safety.
