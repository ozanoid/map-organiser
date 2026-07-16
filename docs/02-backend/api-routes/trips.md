---
title: Trips routes
type: route-group
domain: backend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - src/app/api/trips/route.ts
  - src/app/api/trips/[id]/route.ts
  - src/app/api/trips/[id]/auto-plan/route.ts
  - src/app/api/trips/[id]/days/[dayId]/route.ts
  - src/app/api/trips/[id]/days/[dayId]/places/route.ts
  - src/app/api/trips/[id]/days/[dayId]/reorder/route.ts
  - src/app/api/trips/[id]/swap-days/route.ts
  - src/lib/trip/cost-defaults.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/trips]]"
  - "[[../schema/trips]]"
  - "[[../schema/trip_days]]"
  - "[[../schema/trip_day_places]]"
  - "[[../../04-integrations/mapbox]]"
---

# Trips routes

> **v1.22.0 (S4 NF-07/NF-08):** new `PATCH /api/trips/[id]/days/[dayId]` (routing_profile + notes); trip PATCH is now Zod-whitelisted (the raw-body spread was a security hole — every column was client-writable) and accepts `party_size`; day-place PATCH gained a second in-place-update shape (`cost_estimate`/`time_slot`/`notes`); place inserts seed `cost_estimate` from price_level; move + auto-plan rewrites now carry cost/currency/time_slot/notes (silently dropped before); Directions calls are tracked as `mapbox_directions`. The AI planner `POST /api/ai/trip-plan` also writes these tables — documented under [[ai]].

Seven route handler files covering trips, days, and day-places. The `/api/shared/[slug]` route (when `resource_type = "trip"`) also reads from these tables but is documented under [[shared]].

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/trips` | List user's trips. |
| `POST` | `/api/trips` | Create trip + materialize days (optionally seed from list; costs seeded from price_level). |
| `GET` | `/api/trips/[id]` | Detail with days + places + per-day Mapbox route (per-day `routing_profile`). |
| `PATCH` | `/api/trips/[id]` | Update trip metadata (Zod whitelist, incl. `party_size`). |
| `DELETE` | `/api/trips/[id]` | Delete trip (cascade). |
| `POST` | `/api/trips/[id]/auto-plan` | Re-run distribution algorithm (carries row fields since v1.22.0). |
| `POST` | `/api/trips/[id]/swap-days` | Swap adjacent days. |
| `PATCH` | `/api/trips/[id]/days/[dayId]` | v1.22.0 — update one day: `routing_profile` and/or `notes`. |
| `POST/DELETE/PATCH` | `/api/trips/[id]/days/[dayId]/places` | Add / remove / move place within trip days, or in-place row update (v1.22.0). |
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
- **DB:** `trips` INSERT; `trip_days` INSERT (one per date in range); `trip_day_places` INSERT if seeded from list or place_ids; `list_places` SELECT when seeding from list; `places` SELECT for `google_data` (cost seeding, v1.22.0).
- **Response:** Created trip with computed counts.
- **Notes:** All places seeded into day 1 by default — auto-plan will redistribute later. Since v1.22.0 each seeded row gets `cost_estimate` from `defaultCostEstimate(google_data)` (`src/lib/trip/cost-defaults.ts` — price_level 1→$10, 2→$25, 3→$50, 4→$90; null when no price_level).

### `GET /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **Auth:** required + ownership check.
- **DB:** `trips` SELECT; `trip_days` SELECT; `trip_day_places` SELECT joined with `places` + `categories`.
- **External:** `getRoute(coords, day.routing_profile)` (Mapbox Directions) — **one request per day with ≥ 2 places**, using each day's `routing_profile` (walking/driving/cycling, NF-07 v1.22.0).
- **Response:** Trip with `days[]`, each day with `places[]` and `route` (`distance_km`, `duration_min`, `geometry: LineString`, `legs[]`).
- **Notes:** Place locations transformed from EWKB to `{ lat, lng }`. Mapbox cost: every detail GET hits Directions once per multi-stop day — since v1.22.0 each call is tracked via `trackUsage(user.id, "mapbox_directions")` (previously fully untracked). See [[../../01-domain/trips#mapbox-directions-integration]] for cost model.

### `PATCH /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **Body (Zod whitelist, v1.22.0):** `{ name?, start_date?, end_date?, color?, notes?, party_size?, list_id? }` — at least one field required (400 on empty body). `party_size` is `int 1–50` (mirrors the DB CHECK).
- **DB:** `trips` UPDATE. Sets `updated_at`.
- **Notes:** Pre-v1.22.0 this handler spread the raw JSON body into the UPDATE — every `trips` column (including `user_id`) was client-writable; NF-08's `party_size` would have ridden the same unvalidated path, hence the whitelist. Doesn't re-materialize days if dates shift — that would orphan/duplicate `trip_days`. Worth handling explicitly if dates are mutable.

### `DELETE /api/trips/[id]`

- **Source:** `src/app/api/trips/[id]/route.ts`
- **DB:** `trips` DELETE → cascades to `trip_days` → cascades to `trip_day_places`.

### `POST /api/trips/[id]/auto-plan`

- **Source:** `src/app/api/trips/[id]/auto-plan/route.ts`
- **DB:** `trips` SELECT; `trip_days` SELECT; `trip_day_places` SELECT (snapshot of `cost_estimate/currency/time_slot/notes` per place, v1.22.0); **`trip_day_places` DELETE all + INSERT new**; `places` SELECT joined with `categories`.
- **External:** `autoPlanTrip` from `src/lib/trip/auto-plan.ts` (k-means + nearest-neighbor).
- **Response:** `{ success: true, planned: [{ dayNumber, placeCount }] }`.
- **Notes:** **Destructive** for day assignments — wipes and redistributes. Since v1.22.0 the rewrite carries each place's `cost_estimate/currency/time_slot/notes` by `place_id` (user-entered values were silently destroyed before). Aggregates all distinct places across the trip's current days, then redistributes.

### `POST /api/trips/[id]/swap-days`

- **Source:** `src/app/api/trips/[id]/swap-days/route.ts`
- **Body:** `{ dayId: string, direction: "up"|"down" }`.
- **DB:** `trip_days` SELECT + 2 UPDATEs (the target day and the adjacent one swap `day_number` + `date`).
- **Response:** `{ success: true }`. `400` on bound errors.

### `PATCH /api/trips/[id]/days/[dayId]`

New in v1.22.0 (NF-07).

- **Source:** `src/app/api/trips/[id]/days/[dayId]/route.ts`
- **Body (Zod, at least one field):** `{ routing_profile?: "walking"|"driving"|"cycling", notes?: string|null }` (notes ≤ 2000 chars).
- **DB:** `trips` SELECT (ownership: two-level walk day → trip → user, 404 if not owned) + `trip_days` UPDATE scoped to `id = dayId AND trip_id = tripId`.
- **Response:** the updated `trip_days` row. `400` invalid body, `404` trip/day not found.
- **Notes:** Powers the day-header route-mode cycle button (walking → driving → cycling); `notes` editing rides along since the AI planner (AI-09) writes day themes there.

### `POST /api/trips/[id]/days/[dayId]/places`

- **Source:** `src/app/api/trips/[id]/days/[dayId]/places/route.ts`
- **Body:** `{ place_id }`.
- **DB:** `trip_day_places` SELECT (for max sort_order) + `places` SELECT (`google_data`) + INSERT.
- **Response:** `{ success: true }`.
- **Notes:** v1.22.0 — the INSERT seeds `cost_estimate` via `defaultCostEstimate(place.google_data)` (price_level tiers; null when absent).

### `DELETE /api/trips/[id]/days/[dayId]/places`

- **Source:** same file as above.
- **Body:** `{ place_id }`.
- **DB:** `trip_day_places` DELETE.

### `PATCH /api/trips/[id]/days/[dayId]/places`

- **Source:** same file as above.
- **Body — two shapes (v1.22.0 widened for NF-08):**
  - **Move:** `{ place_id, target_day_id }` → DELETE from source day + INSERT into target day (new id, auto sort_order). Since v1.22.0 the route reads the row's `cost_estimate/currency/time_slot/notes` FIRST and carries them into the insert — pre-v1.22.0 the move silently dropped them.
  - **In-place update:** `{ place_id, cost_estimate? | time_slot? | notes? }` → plain UPDATE (id unchanged). `cost_estimate` clamped 0–100000 nullable; `time_slot` ≤ 40 chars; `notes` ≤ 2000 chars. At least one field beyond `place_id` required.
- **Response:** `{ success: true }`; `400` when the body matches neither shape.
- **Notes:** Move = DELETE + INSERT. The row's `id` changes after a move.

### `PATCH /api/trips/[id]/days/[dayId]/reorder`

- **Source:** `src/app/api/trips/[id]/days/[dayId]/reorder/route.ts`
- **Body:** `{ placeIds: string[] }`.
- **DB:** `trip_day_places` UPDATE — one UPDATE per place_id setting `sort_order = index`.
- **Notes:** Assumes all placeIds already belong to the day; no validation per ID. Parallel UPDATEs — same atomicity caveat as list reorder.

## Cross-route concerns

- **Ownership.** All day/place mutation routes verify the parent trip's `user_id`. RLS adds belt-and-suspenders coverage.
- **Mapbox cost.** Only `GET /api/trips/[id]` and `GET /api/shared/[slug]` (trip path) hit Directions. Both call once per multi-stop day, every read, with the day's `routing_profile`. Since v1.22.0 both track `mapbox_directions` in `api_usage` ($2/1k past 100k free) — in the shared view the call is attributed to the link **owner** (`link.user_id`), not the anonymous viewer. Still no cache (v2). See [[../../01-domain/trips#mapbox-directions-integration]].
- **Row-field preservation.** Every delete+insert rewrite of `trip_day_places` (move, auto-plan, and the AI planner in [[ai]]) must snapshot and carry `cost_estimate/currency/time_slot/notes` — the v1.22.0 contract. A new rewrite path that forgets this reintroduces silent data loss.
- **Sort-order discipline.** Adds use `MAX + 1`; reorders rewrite by index; auto-plan (and AI plan) wholesale replace.

## Open questions

- **Date range mutation.** `PATCH /api/trips/[id]` allows date changes but doesn't reconcile `trip_days`. Decide: forbid date changes on populated trips, or auto-add/remove days.
- **Route caching.** Every trip GET recomputes Mapbox routes. If the route stays stable, persist `route` JSON on `trip_days` to skip the recompute. Trade-off: stale routes if places move.
- **Bulk swap.** `swap-days` swaps one pair at a time. A "reorder all days" UI would need a batch endpoint.
