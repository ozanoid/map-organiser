---
title: Trips routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/trips/route.ts
  - src/app/api/trips/[id]/route.ts
  - src/app/api/trips/[id]/auto-plan/route.ts
  - src/app/api/trips/[id]/days/[dayId]/places/route.ts
  - src/app/api/trips/[id]/days/[dayId]/reorder/route.ts
  - src/app/api/trips/[id]/swap-days/route.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/trips]]"
  - "[[../schema/trips]]"
  - "[[../schema/trip_days]]"
  - "[[../schema/trip_day_places]]"
  - "[[../../04-integrations/mapbox]]"
---

# Trips routes

Six route handler files covering trips, days, and day-places. The `/api/shared/[slug]` route (when `resource_type = "trip"`) also reads from these tables but is documented under [[shared]].

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/trips` | List user's trips. |
| `POST` | `/api/trips` | Create trip + materialize days (optionally seed from list). |
| `GET` | `/api/trips/[id]` | Detail with days + places + per-day Mapbox route. |
| `PATCH` | `/api/trips/[id]` | Update trip metadata. |
| `DELETE` | `/api/trips/[id]` | Delete trip (cascade). |
| `POST` | `/api/trips/[id]/auto-plan` | Re-run distribution algorithm. |
| `POST` | `/api/trips/[id]/swap-days` | Swap adjacent days. |
| `POST/DELETE/PATCH` | `/api/trips/[id]/days/[dayId]/places` | Add / remove / move place within trip days. |
| `PATCH` | `/api/trips/[id]/days/[dayId]/reorder` | Reorder places within a day. |

All require auth.

---

## Per-route detail

### `GET /api/trips`

- **Source:** `src/app/api/trips/route.ts`
- **DB:** `trips` SELECT; `trip_days` and `trip_day_places` counted for `day_count` / `place_count`.
- **Response:** `Trip[]` ordered by `start_date DESC`. No nested `days` (use `GET /api/trips/[id]` for that).

### `POST /api/trips`

- **Source:** `src/app/api/trips/route.ts`
- **Body:** `{ name, start_date, end_date, list_id?, place_ids?[] }`.
- **DB:** `trips` INSERT; `trip_days` INSERT (one per date in range); `trip_day_places` INSERT if seeded from list or place_ids; `list_places` SELECT when seeding from list.
- **Response:** Created trip with computed counts.
- **Notes:** All places seeded into day 1 by default — auto-plan will redistribute later.

### `GET /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **Auth:** required + ownership check.
- **DB:** `trips` SELECT; `trip_days` SELECT; `trip_day_places` SELECT joined with `places` + `categories`.
- **External:** `getRoute` (Mapbox Directions) — **one request per day with ≥ 2 places**.
- **Response:** Trip with `days[]`, each day with `places[]` and `route` (`distance_km`, `duration_min`, `geometry: LineString`, `legs[]`).
- **Notes:** Place locations transformed from EWKB to `{ lat, lng }`. Mapbox cost: every detail GET hits Directions once per multi-stop day. See [[../../01-domain/trips#mapbox-directions-integration]] for cost model.

### `PATCH /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **Body:** any trip column (`name`, `start_date`, `end_date`, `color`, `notes`) — all optional.
- **DB:** `trips` UPDATE. Sets `updated_at`.
- **Notes:** Doesn't re-materialize days if dates shift — that would orphan/duplicate `trip_days`. Worth handling explicitly if dates are mutable.

### `DELETE /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **DB:** `trips` DELETE → cascades to `trip_days` → cascades to `trip_day_places`.

### `POST /api/trips/[id]/auto-plan`

- **Source:** `src/app/api/trips/[id]/auto-plan/route.ts`
- **DB:** `trips` SELECT; `trip_days` SELECT; **`trip_day_places` DELETE all + INSERT new**; `places` SELECT joined with `categories`.
- **External:** `autoPlanTrip` from `src/lib/trip/auto-plan.ts` (k-means + nearest-neighbor).
- **Response:** `{ success: true, planned: [{ dayNumber, placeCount }] }`.
- **Notes:** **Destructive** — wipes existing assignments. Aggregates all distinct places across the trip's current days, then redistributes.

### `POST /api/trips/[id]/swap-days`

- **Source:** `src/app/api/trips/[id]/swap-days/route.ts`
- **Body:** `{ dayId: string, direction: "up"|"down" }`.
- **DB:** `trip_days` SELECT + 2 UPDATEs (the target day and the adjacent one swap `day_number` + `date`).
- **Response:** `{ success: true }`. `400` on bound errors.

### `POST /api/trips/[id]/days/[dayId]/places`

- **Source:** `src/app/api/trips/[id]/days/[dayId]/places/route.ts`
- **Body:** `{ place_id }`.
- **DB:** `trip_day_places` SELECT (for max sort_order) + INSERT.
- **Response:** `{ success: true }`.

### `DELETE /api/trips/[id]/days/[dayId]/places`

- **Source:** same file as above.
- **Body:** `{ place_id }`.
- **DB:** `trip_day_places` DELETE.

### `PATCH /api/trips/[id]/days/[dayId]/places`

- **Source:** same file as above.
- **Body:** `{ place_id, target_day_id }`.
- **DB:** `trip_day_places` DELETE from source day + INSERT into target day (new id, auto sort_order).
- **Notes:** Move = DELETE + INSERT. The row's `id` changes after a move.

### `PATCH /api/trips/[id]/days/[dayId]/reorder`

- **Source:** `src/app/api/trips/[id]/days/[dayId]/reorder/route.ts`
- **Body:** `{ placeIds: string[] }`.
- **DB:** `trip_day_places` UPDATE — one UPDATE per place_id setting `sort_order = index`.
- **Notes:** Assumes all placeIds already belong to the day; no validation per ID. Parallel UPDATEs — same atomicity caveat as list reorder.

## Cross-route concerns

- **Ownership.** All day/place mutation routes verify the parent trip's `user_id`. RLS adds belt-and-suspenders coverage.
- **Mapbox cost.** Only `GET /api/trips/[id]` and `GET /api/shared/[slug]` (trip path) hit Directions. Both call once per multi-stop day, every read. See [[../../01-domain/trips#mapbox-directions-integration]].
- **Sort-order discipline.** Adds use `MAX + 1`; reorders rewrite by index; auto-plan is the only path that wholesale replaces.

## Open questions

- **Date range mutation.** `PATCH /api/trips/[id]` allows date changes but doesn't reconcile `trip_days`. Decide: forbid date changes on populated trips, or auto-add/remove days.
- **Route caching.** Every trip GET recomputes Mapbox routes. If the route stays stable, persist `route` JSON on `trip_days` to skip the recompute. Trade-off: stale routes if places move.
- **Bulk swap.** `swap-days` swaps one pair at a time. A "reorder all days" UI would need a batch endpoint.
