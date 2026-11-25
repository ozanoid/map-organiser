---
title: plans, plan_days, plan_stops
type: table
domain: backend
version: 1.4.0
last_updated: 25.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118005355_plans_tables.sql
  - supabase/migrations/20261118010309_plan_functions.sql
  - supabase/migrations/20261118020401_plan_changes_by_day_id.sql
  - supabase/migrations/20261118025229_stop_status_follows_visits.sql
related:
  - "[[_README]]"
  - "[[visits]]"
  - "[[trips]]"
  - "[[lists]]"
  - "[[../rls-policies]]"
  - "[[../../01-domain/plans]]"
  - "[[../api-routes/plans]]"
  - "[[../../_plans/phase-1-planning]]"
---

# `plans`, `plan_days`, `plan_stops`

The single planning model: an evening outing and a multi-day trip are both a **plan** with 1..N **days** of ordered **stops**. Created on 18.11.2026 (`plans_tables`) as the *expand* step that replaces [[trips]] / [[trip_days]] / [[trip_day_places]].

**State (18.11.2026):** the app runs on these tables since v1.37.0 — every read and write goes through `src/lib/plans/` ([[../../01-domain/plans]]). The trip tables still exist, unused, until they are dropped (separate approval). On main since 18.11.2026 — see [[../../_plans/phase-1-planning#Geçiş ve regresyon]] for the cutover steps.

## The one rule about dates

Dates live in one place, `plans.start_date`:

- a day's date = `start_date + (day_number - 1)`;
- the plan's end date = `start_date + (number of days - 1)`;
- `start_date` NULL = the plan is not scheduled yet (it still has its day structure).

Nothing else stores a date, so moving a plan is a one-row update and day dates cannot drift. (The trip tables stored `start_date`, `end_date` and a `date` per day; `PATCH /api/trips/[id]` updated only the first two.) In code the rule lives in `src/lib/plans/dates.ts`.

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

The own-place rule exists because the public share view reads plans with the service role: a foreign place id attached to a stop would leak that place. The trips code guarded this in the route; here the database does.

Checked on 18.11.2026 as a signed-in user inside a rolled-back transaction: own plans visible only to their owner (admin 5, another account 0, anon 0); stop on a foreign place blocked; free-text stop accepted; a stop with neither place nor title, and a stop with both time and day part, rejected; undated plan accepted; a plan for another user blocked; two day numbers swapped in one statement.

## Functions — the write path

Applied 18.11.2026 (`plan_functions`; `apply_plan_changes` revised the same day by `plan_changes_by_day_id` — see below). Every change that touches more than one row goes through one of these, so it is one transaction: a plan is never half-created and a batch of edits applies completely or not at all. All are `SECURITY INVOKER` (RLS applies to a signed-in caller); `EXECUTE` is granted to `authenticated` and `service_role` only. Because the service role bypasses RLS, the functions also check ownership through `p_user_id`.

| Function | What it does |
|---|---|
| `create_plan(p_user_id, p_plan jsonb) → uuid` | Inserts the plan, its days (numbered in array order) and their stops. A plan always gets at least one day. Refuses a list or a place that is not the user's. |
| `apply_plan_changes(p_user_id, p_plan_id, p_changes jsonb) → jsonb` | `set` (name, notes, party_size, start_date, status, color — a present key is applied, `null` clears) and `ops`, applied in order. Returns `{ added_days, added_stops }`. |
| `plan_insert_stop(p_user_id, p_day_id, p_sort, p_stop jsonb) → uuid` | Inserts one stop; needs a `place_id` (own place) or a `title`; an exact time wins over a day part. |
| `plan_assert_caller(p_user_id)` | A signed-in caller may only act for themselves. |

Ops of `apply_plan_changes`. Where an op names a day it takes `day` (the day's number, 1-based) **or** `day_id`:

| Op | Fields | Rule |
|---|---|---|
| `add_day` | `position?` (1-based), `notes?`, `routing_profile?` | Default: after the last day; later days shift. At most 60 days. |
| `remove_day` | `day` \| `day_id` | Only an empty day; a plan keeps at least one day. Later days shift down. |
| `swap_days` | `a`, `b` — or `a_id`, `b_id` | Both must be days of the plan. |
| `set_day` | `day` \| `day_id`, `notes?`, `routing_profile?` | — |
| `add_stop` | `day` \| `day_id`, `position?` (0-based), stop fields | Default: end of the day. At most 200 stops a day. |
| `update_stop` | `stop_id`, `title?`, `start_time?`, `day_part?`, `notes?`, `cost_estimate?`, `currency?`, `status?` | Setting a time clears the day part and the other way round; a status change stamps `status_at`. A stop at a saved place gets `done` (and leaves it) only through its visit — see below. |
| `move_stop` | `stop_id`, `day` \| `day_id`, `position?` | Within a day or across days; both days stay densely ordered. |
| `remove_stop` | `stop_id` | — |
| `reorder_stops` | `day` \| `day_id`, `stop_ids[]` | Must list every stop of the day. |

**Number or id.** A screen that shows a plan sends ids: if the days were renumbered meanwhile (a queued "remove day 1", an edit in another tab) the change still lands on the day that was shown, and a day that is gone is refused ("that day is no longer part of this plan") instead of being written to another day. Numbers are for callers that think in dates — AI Plan ("day 2 is the Saturday"), the assistant.

**Stop order.** `sort_order` is an ordering key; the positions the ops take are indexes. Nothing keeps the two equal by itself — deleting a place removes its stops through the foreign key and leaves a gap, and the rows copied from the trip tables came with gaps (2 of 40 days on 18.11.2026) — so `apply_plan_changes` first renumbers the plan's stops 0..n−1 per day, then runs the ops. A plan's order is therefore dense after its first change; reads only sort and don't care.

**`plan_changes_by_day_id` (18.11.2026)** added the three things above — day ids, the renumbering, the two limits — after a review of the calling code found that "add at the end" landed in the middle of a day with a gap, and that a change addressed by day number could be queued behind a renumbering and hit another day.

Tested on 18.11.2026 — first as a dry run in a rolled-back transaction, as a signed-in user: create with a place stop and a free-text stop; a foreign place and a blank name refused with nothing left behind; a batch of six edits; swapping days and inserting a day at the front; removing a non-empty day refused with the reason; reorder + remove; a batch with one bad op refused **entirely**; cancel and unschedule; acting for another user, another user editing the plan, and `anon` all refused. The function bodies in the database hash-match the repo files (after the revision: `apply_plan_changes` md5 `5d6f93ee…`, same in both).

**A stop's status follows its visit** (`stop_status_follows_visits`, 18.11.2026 — the third version of `apply_plan_changes`). A stop at a saved place is `done` exactly when a visit fulfils it: `log_visit` marks it done together with the visit, `delete_visit` makes it planned again. So `update_stop` refuses `status: done` for a stop with a place that isn't done yet ("a stop at a saved place is marked done by logging the visit") and any other status for a stop that has a visit ("this stop has a visit; delete the visit to change its status"). A free-text stop is ticked off with `update_stop` as before. See [[visits]].

**Preview** (`20261125120000_plan_preview.sql`, v1.53.0 — written and checked in a rolled-back transaction on 25.11.2026, **not applied yet**):

| Function | What it does |
|---|---|
| `plan_snapshot(p_user_id, p_plan_id) → jsonb` | The plan as one value: name, start date, party size, notes, status, and its days in order with their notes and stops in order (place name or text, time or part of the day, notes, status, cost). |
| `preview_plan_changes(p_user_id, p_plan_id, p_changes) → jsonb` | `{ before, after }`: the snapshot, then `apply_plan_changes` with the same changes inside a block that always ends in an exception (custom SQLSTATE `P0PRV`), so everything it did is rolled back, and the snapshot taken just before. Unique day numbers are checked inside (`set constraints … immediate`), as the save checks them at commit. A change that can't be applied raises as the save would (e.g. 22023 "stop … does not belong to this plan"). |

What the assistant's card shows for a plan change, and what its yes is checked against ([[../../04-integrations/claude-agent#approval]]). The dry run, on the test account's 4-day, 19-stop plan: moving a stop to day 2, a day note and a rename showed in `after`; the plan read the same before and after the call (nothing persisted); a remove of a stop not in the plan raised 22023; ~15 KB returned; the functions were gone after the rollback.

Callers: `createPlan` / `changePlan` / `previewPlanChanges` in `src/lib/plans/write.ts` — the only code that calls these functions. `npm run check:assistant -- plans` exercises them through that module against the live database (44 checks on 18.11.2026, including a change by day id, an unknown day id refused, a gap in the order healed, and the 61st day refused).

## Copy from the trip tables

`plans_tables` copied every trip with the same ids: `time_slot` → `day_part` (the live values were only the four day parts or NULL; an `HH:MM` value would become `start_time`, any other text would be put in front of the note), `end_date` and `trip_days.date` dropped. Verified after applying: 7 / 40 / 127 rows, derived day dates and end dates equal the stored ones in every row, cost totals equal.

## Open questions

- Trips created through the old UI between this copy and the cutover have to be copied again at cutover (the copy is by id, so it can be repeated for missing rows). On 18.11.2026 none was missing (7 trips, 7 plans).
