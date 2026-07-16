---
title: trips
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
  - "[[trip_day_places]]"
  - "[[lists]]"
  - "[[../../01-domain/trips]]"
---

# `trips`

> **v1.22.0 (NF-08):** new `party_size` column (migration `add_trips_party_size`) — the trip header's budget total is `Σ per-person cost_estimate × party_size`, adjustable via a stepper in the UI. Stripped from the public share payload (owner-private). Alongside it, `PATCH /api/trips/[id]` switched from a raw-body spread (every column client-writable, `user_id` included) to a Zod whitelist.

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
| `party_size` | int | no | `1` | v1.22.0 (NF-08). CHECK: 1–50. Multiplier for the trip budget total (costs are per-person). Not exposed in the public share payload. |
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

- **Migration.** `create_trips_table` (2026-04-15), `add_trips_party_size` (2026-07-16, v1.22.0).
- **Day materialization on create.** `POST /api/trips` calculates `end_date - start_date + 1` days and INSERTs that many `trip_days` rows in one go.
- **Day-count + place-count are computed, not stored.** Both come back as derived fields from the API joins.
- **PATCH is Zod-whitelisted (v1.22.0).** Writable columns: `name`, `start_date`, `end_date`, `color`, `notes`, `party_size`, `list_id`. The pre-v1.22.0 handler spread the raw body into the UPDATE — any column was client-writable.
- Consumed by: every `/api/trips/*` route, `/api/ai/trip-plan` (ownership check + day frame), `/api/shared/[slug]` (when `resource_type = 'trip'`; `party_size` stripped from the payload), `/api/places/bulk` `check_trips` action (to warn before bulk-delete).

## Open questions

- **`idx_trips_user`.** Add `CREATE INDEX idx_trips_user ON public.trips (user_id)` once row count grows past a few hundred.
- **Auto-`updated_at`.** Like other tables in the repo, `updated_at` is app-managed. Wire a `moddatetime` trigger for safety.
