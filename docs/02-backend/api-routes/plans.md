---
title: Plans routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/plans/route.ts
  - src/app/api/plans/[id]/route.ts
  - src/app/api/plans/[id]/auto-plan/route.ts
  - src/app/api/plans/[id]/days/[dayId]/route/route.ts
  - src/lib/plans/http.ts
  - src/lib/plans/schema.ts
  - src/lib/plans/read.ts
  - src/lib/plans/write.ts
  - src/lib/plans/route-signature.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/plans]]"
  - "[[../schema/plans]]"
  - "[[ai]]"
  - "[[shared]]"
  - "[[../../03-frontend/hooks/use-plans]]"
---

# Plans routes

Five handlers in four files. They are thin: auth, zod, one call into `src/lib/plans/` ([[../../01-domain/plans#One write path]]), and `planErrorResponse` to turn the module's errors into a status.

All require a signed-in user (401 otherwise; the middleware redirects signed-out requests to `/login` before they get here).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/plans` | — | `Plan[]` without days or stops; `day_count`, `stop_count`, derived `end_date`. Newest start date first, plans without a date first. |
| POST | `/api/plans` | `{ name, start_date?, day_count? (1–60, default 1), list_id? }` | `201 { id }` |
| GET | `/api/plans/[id]` | — | `Plan` with `days[].stops[].place` (light projection). No routes. |
| PATCH | `/api/plans/[id]` | `{ set?, ops? }` | `{ plan, added_days, added_stops }` — the plan as it is afterwards (`null` if it couldn't be read back) |
| DELETE | `/api/plans/[id]` | — | `{ success: true }` |
| POST | `/api/plans/[id]/auto-plan` | — | `{ plan }` |
| GET | `/api/plans/[id]/days/[dayId]/route?sig=…` | — | `{ route }` — a `PlanRoute` or `null`; 409 / 502 below |

## `POST /api/plans`

Creates the plan and `day_count` empty days in one transaction. With `list_id` the list's places (in list order) become the stops of day 1 — the list must be the user's own, and `plans.list_id` records it. Only the user's own places are taken (a list can hold a foreign place id after a half-failed shared-list copy); a list with more than 200 places is refused with a message.

## `PATCH /api/plans/[id]`

The only way the UI changes a plan. The body is `planChangesSchema` (`src/lib/plans/schema.ts`):

```jsonc
{
  "set": { "name": "…", "notes": null, "party_size": 2, "start_date": "2027-03-12", "status": "cancelled", "color": "#059669" },
  "ops": [
    { "op": "add_day", "position": 1 },
    { "op": "remove_day", "day_id": "…" },
    { "op": "swap_days", "a_id": "…", "b_id": "…" },
    { "op": "set_day", "day_id": "…", "routing_profile": "cycling", "notes": null },
    { "op": "add_stop", "day_id": "…", "position": 0, "place_id": "…" },
    { "op": "add_stop", "day": 1, "title": "Meet at the Old Street exit", "start_time": "19:30" },
    { "op": "update_stop", "stop_id": "…", "day_part": "evening", "cost_estimate": 25 },
    { "op": "move_stop", "stop_id": "…", "day_id": "…", "position": 0 },
    { "op": "remove_stop", "stop_id": "…" },
    { "op": "reorder_stops", "day_id": "…", "stop_ids": ["…", "…"] }
  ]
}
```

- `set` first, then `ops` in order; all in one transaction — one bad op refuses the whole request and nothing is applied.
- A day is named by `day_id` or by `day` (its number, 1-based) — one of the two; `swap_days` takes `a_id` + `b_id` or `a` + `b`. The app sends ids, so a change queued behind a renumbering, or sent from a tab that is behind, lands on the day that was shown or is refused — never on another day. Stops are named by id; stop positions are 0-based.
- Limits: 60 days a plan, 200 stops a day (zod and the database).
- `null` clears (`start_date: null` unschedules the plan; `start_time: null` clears a time); a missing key is left alone.
- `add_stop` without a `cost_estimate` gets the default for the place's price level; `cost_estimate: null` means "no estimate" and stays empty.
- The change is committed before the plan is read back. If that read fails the response is still 200, with `plan: null` — the client refetches.
- Errors: 400 with the reason (zod's first issue, or the database's message — "day 2 still has 1 stop(s); move or remove them first", "place … is not one of this user's places"); 404 when the plan isn't the caller's.

## `GET /api/plans/[id]/days/[dayId]/route`

The day's route through its stops that have a located place (Mapbox Directions, the day's `routing_profile`). `{ route: null }` for fewer than two. The coordinates come from the database, not from the request, so the endpoint can't be used as a Directions proxy. One `mapbox_directions` unit per route Mapbox returns, recorded in `after()`.

- **`sig`** is the day's signature as the client sees it (`routeSignature` in `src/lib/plans/route-signature.ts`: profile + the located stops in order, hashed). The client caches the answer under it. If the day read here has another signature — the plan changed between the client's render and this request — the answer is **409**, so a route for one arrangement is never stored under another's key.
- **502** when Mapbox gives no route (rate limit, network). An error is retried and not cached; a 200 with `null` would be remembered as "this day has no route".

The client decides when to ask: [[../../03-frontend/hooks/use-plans#Routes]].

## Checked

`npm run check:assistant -- plans` runs the module these routes call against the live database on the test account (44 checks on 18.11.2026: read shape and size, create, a batch of changes, all-or-nothing, changes by day id, an order gap healed, the day limit, another user's place and plan refused, auto-plan, one route and its signature, cleanup).
