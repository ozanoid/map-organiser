---
title: Plan Flow
type: flow
domain: plans
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/plans/route.ts
  - src/app/api/plans/[id]/route.ts
  - src/app/api/plans/[id]/auto-plan/route.ts
  - src/app/api/plans/[id]/days/[dayId]/route/route.ts
  - src/lib/plans/write.ts
  - src/lib/plans/read.ts
  - src/lib/plans/auto-plan.ts
  - src/lib/plans/directions.ts
  - src/components/plans/create-plan-dialog.tsx
  - src/app/(app)/plans/[id]/page.tsx
related:
  - "[[../01-domain/plans]]"
  - "[[../02-backend/api-routes/plans]]"
  - "[[../03-frontend/components/plans]]"
  - "[[ai-plan-flow]]"
  - "[[share-flow]]"
---

# Plan Flow

From "New Plan" to a shared itinerary. Replaces the trip planning flow (v1.37.0).

## 1. Create

`/lists?tab=plans` → **New Plan** → name, number of days, optionally a date, optionally a list.

1. `POST /api/plans { name, start_date?, day_count, list_id? }`.
2. With a list: `stopsFromList` reads its places in list order; they become the stops of day 1.
3. `createPlan` fills the default cost of each place stop and calls `create_plan` — plan, days and stops in one transaction.
4. The dialog opens `/plans/<id>`.

A plan without a date is fine; so is a one-day plan with one stop.

## 2. Edit

Every edit on the plan page is `PATCH /api/plans/[id] { set?, ops? }` → `changePlan` → `apply_plan_changes`, one transaction, and the response is the plan afterwards ([[../02-backend/api-routes/plans#`PATCH /api/plans/[id]`]]).

| Action | Change sent |
|---|---|
| Add a stop (place or text) | `add_stop` |
| Drag within a day | `reorder_stops` |
| Move to another day | `move_stop` |
| Remove a stop / Undo | `remove_stop` / `add_stop` at the old position (planned stops only) |
| Time, cost | `update_stop` |
| Route mode | `set_day { routing_profile }` |
| Move a day earlier / later | `swap_days` |
| Add / remove a day | `add_day` / `remove_day` (empty days only) |
| Dates | `set { start_date }` — `null` removes them |
| Rename, party size | `set { name }`, `set { party_size }` |
| Cancel / restore | `set { status }` |

The app names days by id in these changes (`day_id`, `a_id` / `b_id`), so one that waits behind another change, or comes from a tab that is behind, lands on the day that was shown or is refused.

Changing the start date moves every day (a day's date is derived). In the trips model `PATCH` updated the trip's dates and left the days where they were.

## 3. Auto Plan

`POST /api/plans/[id]/auto-plan` → `autoPlanStops`: k-means over the located, still-planned stops (one cluster per day), each day ordered by a daily rhythm, applied as `move_stop` ops in one batch. Stops without a place, and stops already done or skipped, keep their day.

## 4. Routes

For each day with two or more located stops the page asks `GET /api/plans/[id]/days/[dayId]/route` once and keeps the answer until the day's stops, their order or the profile change ([[../03-frontend/hooks/use-plans#Routes]]).

## 5. Share

Plan menu → **Copy share link** → `POST /api/shared { resource_type: "plan" }` → `/shared/<slug>` ([[share-flow]]). A plan shared when it was a trip keeps its link.

## 6. Cancel or delete

Cancel keeps the plan, read-only, under "Cancelled" (undo from the toast or Restore on the page). Delete removes the plan, its days and stops; the saved places stay.

## Failure modes

- A change the database refuses (a non-empty day removed, a place that isn't the user's, a stop that was deleted in another tab) → 400 with the reason, shown as a toast; nothing was applied.
- A failed route request (502 from the route endpoint) → one retry, then the day is shown without a route; asked again the next time the plan is opened.
- The change was saved but the plan couldn't be read back → the response says so (`plan: null`) and the page refetches; it is not reported as a failure.
- A failed drag save → the list goes back to the server's order.
