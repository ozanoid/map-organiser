---
title: plans, plan_days, plan_stops
type: table
domain: backend
version: 1.0.0
last_updated: 18.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118005355_plans_tables.sql
related:
  - "[[_README]]"
  - "[[visits]]"
  - "[[trips]]"
  - "[[lists]]"
  - "[[../rls-policies]]"
  - "[[../../_plans/phase-1-planning]]"
---

# `plans`, `plan_days`, `plan_stops`

The single planning model: an evening outing and a multi-day trip are both a **plan** with 1..N **days** of ordered **stops**. Created on 18.11.2026 (`plans_tables`) as the *expand* step that replaces [[trips]] / [[trip_days]] / [[trip_day_places]].

**State (18.11.2026):** the tables exist and hold a copy of the 7 trips (40 days, 127 stops, same ids). **No application code reads or writes them yet** — the app still runs on the trip tables until the cutover; see [[../../_plans/phase-1-planning#Geçiş ve regresyon]].

## The one rule about dates

Dates live in one place, `plans.start_date`:

- a day's date = `start_date + (day_number - 1)`;
- the plan's end date = `start_date + (number of days - 1)`;
- `start_date` NULL = the plan is not scheduled yet (it still has its day structure).

Nothing else stores a date, so moving a plan is a one-row update and day dates cannot drift. (The trip tables stored `start_date`, `end_date` and a `date` per day; `PATCH /api/trips/[id]` updated only the first two.)

## `plans`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. Copied trips keep their id. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `name` | text | no | — | CHECK not blank. |
| `start_date` | date | yes | — | NULL = not scheduled. |
| `status` | text | no | `'planned'` | CHECK `planned` \| `cancelled`. Cancelling keeps the plan. |
| `party_size` | integer | no | `1` | CHECK 1–50. Budget totals multiply by it. |
| `notes` | text | yes | — | — |
| `color` | text | yes | `'#059669'` | Presentational. |
| `list_id` | uuid | yes | — | FK → `lists.id`, ON DELETE SET NULL. The shortlist the plan came from. |
| `created_via` | text | no | `'app'` | CHECK `app` \| `assistant`. Who created it. |
| `created_at` / `updated_at` | timestamptz | no | `now()` | `updated_at` is app-managed. |

## `plan_days`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `plan_id` | uuid | no | — | FK → `plans.id`, ON DELETE CASCADE. |
| `day_number` | integer | no | — | CHECK ≥ 1. UNIQUE with `plan_id`, **deferrable** — two days can swap numbers in one statement. |
| `notes` | text | yes | — | Day theme / note. |
| `routing_profile` | text | no | `'walking'` | CHECK `walking` \| `driving` \| `cycling`. |
| `created_at` | timestamptz | no | `now()` | — |

## `plan_stops`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `day_id` | uuid | no | — | FK → `plan_days.id`, ON DELETE CASCADE. |
| `sort_order` | integer | no | `0` | Order within the day. |
| `place_id` | uuid | yes | — | FK → `places.id`, ON DELETE CASCADE. NULL for a free-text stop. |
| `title` | text | yes | — | Free-text stop ("Meet at Old Street exit"). CHECK: `place_id` or a non-blank `title`. |
| `start_time` | time | yes | — | Local time at the place. |
| `day_part` | text | yes | — | CHECK `morning` \| `afternoon` \| `evening` \| `night`. CHECK: not together with `start_time`. |
| `notes` | text | yes | — | — |
| `cost_estimate` | numeric | yes | — | Per person; CHECK ≥ 0. |
| `currency` | text | yes | `'USD'` | — |
| `status` | text | no | `'planned'` | CHECK `planned` \| `done` \| `skipped`. |
| `status_at` | timestamptz | yes | — | When the status was set. |
| `created_at` | timestamptz | no | `now()` | — |

A stop marked done has, when it has a place, a row in [[visits]] pointing back at it (`visits.plan_stop_id`).

## Indexes

| Name | Table | Columns | Purpose |
|---|---|---|---|
| `plans_pkey` / `plan_days_pkey` / `plan_stops_pkey` | each | `id` | Primary keys. |
| `plans_user_start_idx` | `plans` | `(user_id, start_date)` | A user's plans by date. |
| `plans_list_idx` | `plans` | `list_id` (partial, not null) | Plans built from a list. |
| `plan_days_plan_day_key` | `plan_days` | `(plan_id, day_number)` UNIQUE | Day lookup; also the FK walk for RLS. |
| `plan_stops_day_idx` | `plan_stops` | `(day_id, sort_order)` | A day's stops in order. |
| `plan_stops_place_idx` | `plan_stops` | `place_id` (partial, not null) | "Which plans is this place in". |

(The trip tables have primary keys only.)

## RLS policies

All three: one policy, `FOR ALL TO authenticated`.

| Table | USING | WITH CHECK adds |
|---|---|---|
| `plans` | `auth.uid() = user_id` | `list_id` is NULL or one of the user's own lists |
| `plan_days` | the plan is the user's | — |
| `plan_stops` | the day's plan is the user's | `place_id` is NULL or one of the user's **own places** |

The own-place rule exists because the public share view reads plans with the service role: a foreign place id attached to a stop would leak that place. The trips code guarded this in the route (`src/app/api/trips/route.ts`); here the database does.

Checked on 18.11.2026 as a signed-in user inside a rolled-back transaction: own plans visible only to their owner (admin 5, another account 0, anon 0); stop on a foreign place blocked; free-text stop accepted; a stop with neither place nor title, and a stop with both time and day part, rejected; undated plan accepted; a plan for another user blocked; two day numbers swapped in one statement.

## Copy from the trip tables

`plans_tables` copied every trip with the same ids: `time_slot` → `day_part` (the live values were only the four day parts or NULL; an `HH:MM` value would become `start_time`, any other text would be put in front of the note), `end_date` and `trip_days.date` dropped. Verified after applying: 7 / 40 / 127 rows, derived day dates and end dates equal the stored ones in every row, cost totals equal.

## Open questions

- Plans created through the old UI between this copy and the cutover have to be copied again at cutover (the copy is by id, so it can be repeated for missing rows).
