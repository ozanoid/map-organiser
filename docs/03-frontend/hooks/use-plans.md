---
title: usePlans
type: hook
domain: frontend
version: 1.0.1
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/hooks/use-plans.ts
  - src/components/plans/use-plan-editor.ts
  - src/lib/plans/route-signature.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/plans]]"
  - "[[../../02-backend/api-routes/plans]]"
  - "[[../components/plans]]"
  - "[[../../04-integrations/react-query]]"
---

# `usePlans` and family

Nine exports. Two queries, one route query per day, and — instead of a mutation per kind of edit — **one** mutation for every change to a plan.

## Query keys

| Key | Holds |
|---|---|
| `["plans"]` | the list (`GET /api/plans`) |
| `["plan", id]` | one plan with days and stops; `null` when it doesn't exist |
| `["plan-route", dayId, signature]` | one day's route |

## Exports

| Hook | Does |
|---|---|
| `usePlans()` | the list |
| `usePlan(id)` | one plan; a 404 is `null`, not an error |
| `useCreatePlan()` | `POST /api/plans` → `{ id }`; invalidates `["plans"]` |
| `useDeletePlan()` | `DELETE`; sets `["plan", id]` to `null` (a page still open, or Back, must not show the deleted plan from the cache) and invalidates `["plans"]` |
| `useChangePlan(planId)` | `PATCH { set?, ops? }`; puts the returned plan into `["plan", id]` and invalidates `["plans"]` |
| `usePlanBusy(planId)` | true while a change to this plan is on its way |
| `useAutoPlan(planId)` | `POST …/auto-plan`; puts the returned plan into the cache |
| `useAiPlan(planId)` | `POST /api/ai/day-plan`; puts the returned plan into the cache |
| `usePlanRoutes(plan)` | routes by day id: `undefined` while loading, `null` for none |

## One mutation, no refetch

`PATCH /api/plans/[id]` answers with the plan as it is afterwards, and that answer replaces the cached plan. So there is no refetch after an edit and no cache to patch by hand (the trips hooks had three hand-written cache patches to avoid re-buying routes).

`useChangePlan`, `useAutoPlan` and `useAiPlan` are the same mutation underneath (`usePlanWrite`):

- **one key and one scope** (`scope: { id: "plan-<id>" }`) — every write to a plan runs after the one before it, so two answers can't arrive out of order and leave the older state in the cache. An edit made while AI Plan is generating waits behind it;
- **the read is cancelled first** (`cancelQueries(["plan", id])`) — a slower GET that started earlier must not land on top of the newer answer;
- **the answer goes into the cache**; when the server committed the write but couldn't read the plan back (`plan: null`), the plan is refetched instead; after a failed write it is refetched too.

The day controls (move a day, remove a day, add a day, the route-mode button) are disabled while `usePlanBusy` is true. Every change names its day by **id**, so a change that was queued behind a renumbering still lands on the day that was shown.

## Routes

`usePlanRoutes` runs one query per day (`useQueries`). The key carries the day's **signature** (`routeSignature`, `src/lib/plans/route-signature.ts`: the routing profile and the ids of the day's located stops, in order, hashed short) and `staleTime` is infinite. The signature is sent with the request and the server answers only for that arrangement (409 otherwise). Consequences:

- reordering stops, moving one in or out, or changing the profile asks for a new route for the days it touches, and only those;
- a cost, a note, a time, the party size, the plan's name or dates ask for nothing;
- swapping two days asks for nothing (the key is the day's id and content, not its number);
- coming back to a plan in the same session shows the routes from the cache.

A failed route request (the endpoint answers 502 when Mapbox gives no route) is retried once, then the day is shown without a route (`null`) rather than a spinner that never ends. The failure is not remembered: the next time the plan is opened the route is asked for again.

## `usePlanEditor(planId)`

In `src/components/plans/use-plan-editor.ts`, on top of `useChangePlan`: `apply(changes, { onDone?, onFail? })`. A failure is shown the same way everywhere — the server's message as a toast (it says what was wrong). The same file exports `UNDO_TOAST_MS`. (The icon-only button class moved to `src/components/ui/icon-button.ts`.)
