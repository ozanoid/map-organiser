---
title: Plan
type: entity
domain: plans
version: 1.2.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/plans/schema.ts
  - src/lib/plans/read.ts
  - src/lib/plans/write.ts
  - src/lib/plans/dates.ts
  - src/lib/plans/route-signature.ts
  - src/lib/plans/auto-plan.ts
  - src/lib/plans/directions.ts
  - src/lib/plans/cost-defaults.ts
  - src/lib/plans/day-colors.ts
  - src/lib/api/http.ts
  - src/lib/db/context.ts
  - src/lib/db/errors.ts
  - src/lib/hooks/use-plans.ts
  - src/lib/assistant/tools/get-plans.ts
  - src/lib/assistant/tools/create-plan.ts
  - src/lib/assistant/tools/update-plan.ts
  - src/app/(app)/plans/[id]/page.tsx
  - src/app/(app)/lists/page.tsx
  - next.config.ts
related:
  - "[[places]]"
  - "[[lists]]"
  - "[[sharing]]"
  - "[[../02-backend/schema/plans]]"
  - "[[../02-backend/schema/visits]]"
  - "[[visits]]"
  - "[[../02-backend/api-routes/plans]]"
  - "[[../03-frontend/hooks/use-plans]]"
  - "[[../03-frontend/components/plans]]"
  - "[[../05-flows/plan-flow]]"
  - "[[../05-flows/ai-plan-flow]]"
  - "[[../_plans/phase-1-planning]]"
---

# Plan

An intention for one or more days: an evening out and a multi-day trip are the same thing — a **plan** with 1..N **days**, each holding ordered **stops**. Replaced the trip model in v1.37.0 (design and reasons: [[../_plans/phase-1-planning]]).

Tables: [[../02-backend/schema/plans]] (`plans`, `plan_days`, `plan_stops`). What actually happened — "I was there on this date" — is a different entity, the [[visits|visit]]; a visit can fulfil a stop.

## Shape

Types live in `src/lib/types/index.ts`.

| Type | Holds | Derived by the server |
|---|---|---|
| `Plan` | `name`, `start_date` (nullable), `status` (`planned` \| `cancelled`), `party_size`, `notes`, `color`, `list_id`, `created_via` (`app` \| `assistant`) | `end_date`, `day_count`, `stop_count`, `days` |
| `PlanDay` | `day_number` (1..N), `notes`, `routing_profile` | `date`, `stops`; `route` on the public share view only |
| `PlanStop` | `place_id` **or** `title`; `start_time` (`"HH:MM"`) **or** `day_part`; `notes`, `cost_estimate`, `currency`, `status` (`planned` \| `done` \| `skipped`), `status_at`, `sort_order` | `place` (a `PlanPlace`), `visit` (`{ id, visited_on, rating, notes }` when a visit fulfils it) |
| `PlanPlace` | the part of a place a plan shows: id, name, address, city, country, location, rating, visit status, Google place id, category (name, colour, icon), Google link / rating / review count / price level | — |
| `PlanRoute` | distance, duration, geometry, `legs` (each names its `from_stop_id` and `to_stop_id`) | — |

`PlanPlace` exists because a full `places` row averages ~69 KB (stored reviews, profile). Measured on 18.11.2026: a plan with 47 stops reads in 43 KB and ~300 ms.

## Rules

- **One date.** A plan stores only `start_date`. A day's date is `start_date + (day_number − 1)`, the end date is the last day's date (`src/lib/plans/dates.ts`). Moving a plan is one field; the days cannot drift.
- **A plan may have no date yet.** It keeps its day structure and is scheduled later.
- **A stop is a saved place or a line of text.** "Meet at the Old Street exit" is a stop with a `title` and no place.
- **When is an exact time or a part of the day, never both.** Setting one clears the other.
- **Cancel, don't delete.** `status = cancelled` keeps the plan as it was and can be undone; deleting removes it for good and is only in the UI.
- **A day is removed only when it is empty**, and a plan keeps at least one day. The refusal says why ("day 2 still has 3 stop(s); move or remove them first").
- **Costs are per person.** A stop's `cost_estimate` defaults from the place's price level (`defaultCostEstimate`: 1 → $10, 2 → $25, 3 → $50, 4 → $90); the plan total multiplies by `party_size`.
- **Done at a saved place means a visit.** A stop at a saved place is `done` exactly when a [[visits|visit]] fulfils it: logging the visit ticks the stop, deleting the visit reopens it; the plan's write path refuses any other way. A free-text stop is ticked off directly. `skipped` is set and undone from the stop's menu.
- **Deleting a place removes its stops** (FK cascade). The delete dialogs name the plans first (`plansUsingPlaces`).
- **Day numbers are dense and 1-based. Stop order is an ordering key**: positions are indexes, and every change first closes any gaps in the plan's stop order (a deleted place leaves one), so after its first change a plan's order is 0..n−1 per day.
- **A day is named by id or by number.** The app sends ids — a change can't land on another day because the days were renumbered meanwhile. AI Plan and the assistant use numbers, which follow the dates.
- **Limits:** 60 days a plan, 200 stops a day.

## One write path

Every change is one call into `src/lib/plans/write.ts`, which is one call to a Postgres function, which is one transaction:

| Function | Calls | Used by |
|---|---|---|
| `createPlan(ctx, input, { createdVia })` | `create_plan` | `POST /api/plans`, shared-plan save, Claude's `create_plan` |
| `changePlan(ctx, planId, { set?, ops? })` | `apply_plan_changes` | `PATCH /api/plans/[id]`, auto-plan, AI Plan, Claude's `update_plan` |
| `deletePlan(ctx, planId)` | a delete | `DELETE /api/plans/[id]` |
| `autoPlanStops(ctx, planId)` | `changePlan` with `move_stop` ops | `POST /api/plans/[id]/auto-plan` |

`{ set, ops }` is defined once, in `src/lib/plans/schema.ts` (zod): `set` changes the plan's own fields (name, notes, party size, start date, status, colour); `ops` is a list of `add_day`, `remove_day`, `swap_days`, `set_day`, `add_stop`, `update_stop`, `move_stop`, `remove_stop`, `reorder_stops`, applied in order. `null` clears a field, a missing key leaves it alone. A batch applies completely or not at all. A day number in an op is read when that op runs, after the ops before it. Claude's `create_plan` and `update_plan` take the same shapes (without colour and source list); the schema's `.describe()` texts are what the model reads.

`write.ts` adds what the database can't know: the default cost of a new stop, and which errors are the caller's (`PlanInputError` → 400, `PlanNotFoundError` → 404 — subclasses of the shared `InputError` / `NotFoundError` in `src/lib/db/errors.ts`, which the routes map through `errorResponse` in `src/lib/api/http.ts`). The context type is the shared `UserContext` (`src/lib/db/context.ts`).

Reads are in `src/lib/plans/read.ts`: `listPlans`, `getPlan`, `planOutlines` (each plan's stops by name, for Claude's plan list), `plansUsingPlaces`, `dayRoute`, `withRoutes`. Every query is scoped by the caller's client (RLS) **and** an explicit `user_id` filter — the second is what protects the callers that use the service role (the share view, scripts).

## Routes on the map

A day's route runs through its stops that have a located place, in order, with the day's `routing_profile` (walking / driving / cycling — the day header cycles it). Stops without a place are skipped; a leg names the two stops it joins.

The app asks for a route per day (`GET /api/plans/[id]/days/[dayId]/route?sig=…`) and caches it under the day's signature — the located stops in order and the profile ([[../03-frontend/hooks/use-plans]]); the server answers only for that signature. A cost, a note or the party size changes nothing in that key, so it asks Mapbox for nothing. Each route Mapbox returns is recorded as `mapbox_directions` (100,000 free a month, then $2 per 1,000).

## Where it shows

- `/lists?tab=plans` — the Plans tab: upcoming, no date yet, past, cancelled (`planPhase`). "New Plan": a name, a number of days, optionally a date, optionally the places of a list (they start on day 1).
- `/plans/[id]` — the plan: timeline or map (`?view=map`), dates, budget, Auto Plan, AI Plan, the plan menu (share, dates, rename, cancel / restore, delete). `/trips/[id]` redirects here (plans kept the trips' ids).
- `/shared/[slug]` — the public view of a shared plan ([[sharing]]).
- **Claude** (connector, v1.39.0): `get_plans` lists and reads plans, `create_plan` saves one, `update_plan` changes one; a stop at a saved place is ticked off with `log_visit` (`plan_stop_id`). Claude cancels, never deletes, and gives the plan's link (`/plans/<id>` on the deployment it is connected to) — [[../04-integrations/claude-mcp]].

## Auto Plan and AI Plan

- **Auto Plan** (`autoPlan` in `src/lib/plans/auto-plan.ts`): k-means over the located stops, one cluster per day, each day ordered by a daily rhythm (café → sights → restaurant → bar). Only stops that are still `planned` and have a located place move; the rest keep their day and follow the planned ones. Stops are moved, not recreated — cost, time and note survive.
- **AI Plan**: [[../05-flows/ai-plan-flow]].

## Not yet

- Renaming a free-text stop in place in the app (remove and add again; Claude's `update_stop` can change a title).
