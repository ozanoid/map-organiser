---
title: Trip Planning Flow
type: flow
domain: trips
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
  - src/lib/trip/auto-plan.ts
  - src/lib/trip/directions.ts
  - src/lib/trip/cost-defaults.ts
  - src/app/(app)/trips/[id]/page.tsx
related:
  - "[[../01-domain/trips]]"
  - "[[../02-backend/api-routes/trips]]"
  - "[[../04-integrations/mapbox]]"
  - "[[ai-trip-plan-flow]]"
---

# Trip Planning Flow

> **v1.22.0 (S4):** per-day route mode (NF-07), per-stop budget + party size (NF-08), and a second planning path — the AI planner (`POST /api/ai/trip-plan`, AI-09), covered end-to-end in [[ai-trip-plan-flow]].

End-to-end: from creating a trip out of a list to viewing the finished plan with Mapbox routes.

## Trigger

User clicks "Create trip" on the Lists/Trips page (typically from a list's "Plan a trip" action).

## Steps

```
1. POST /api/trips  { name, start_date, end_date, list_id?, place_ids? }
       │  • INSERT trips row
       │  • Compute day count = end_date - start_date + 1
       │  • INSERT trip_days for each date (day_number 1..N)
       │  • If list_id or place_ids: INSERT trip_day_places into day 1
       │    (auto-plan will redistribute later); cost_estimate seeded
       │    from google_data.price_level (defaultCostEstimate, v1.22.0)
       │
       ▼  React Query invalidates ["trips"]
2. Navigate to /trips/[id]
       │
       ▼
3. GET /api/trips/[id]
       │  • SELECT trip + trip_days + trip_day_places + places + categories
       │  • For each day with ≥ 2 places:
       │      getRoute(coords, day.routing_profile) → Mapbox Directions
       │      + trackUsage("mapbox_directions") (v1.22.0 — was untracked)
       │  • Return Trip with days[].places[] and days[].route
       │
       ▼  React Query caches under ["trip", id]
4. Trip detail page renders: timeline + map
       │  • Timeline: ordered list of days, each with reorderable place rows
       │  • v1.22.0 per row: time_slot chip + notes + CostBadge (inline edit)
       │  • v1.22.0 per day: route-mode cycle button, day total,
       │    day.notes (AI theme) under the header
       │  • v1.22.0 header: trip total ≈ Σ per-person × party_size,
       │    PartySizeControl stepper, AI Plan button (ai-settings gated)
       │  • Map: day-colored polylines + place markers + day-selector pills
       │
       ▼  (optional — user clicks "Auto Plan" — or "AI Plan", see [[ai-trip-plan-flow]])
5. POST /api/trips/[id]/auto-plan
       │  • Aggregate all distinct places across the trip
       │  • Snapshot cost_estimate/currency/time_slot/notes per place_id
       │    (v1.22.0 — user-entered values used to be destroyed here)
       │  • Run autoPlanTrip(places, dayCount):
       │      a. K-means++ cluster (k = dayCount), 8 iterations
       │      b. Sort within day by category preference
       │         (cafe → park → museum/shopping → restaurant → bar)
       │      c. Greedy nearest-neighbor within day (haversine)
       │  • DELETE all trip_day_places for the trip
       │  • INSERT new placements (carrying the snapshotted fields)
       │
       ▼  React Query invalidates ["trip", id] → routes refetch
       │
       ▼  (per-day mutations: add / remove / reorder / move / update / swap-days)
6. Day-level interactions
       │  • POST /api/trips/[id]/days/[dayId]/places — add a place
       │      (cost_estimate seeded from price_level)
       │  • DELETE /api/trips/[id]/days/[dayId]/places — remove a place
       │  • PATCH /api/trips/[id]/days/[dayId]/places — two shapes (v1.22.0):
       │      move: { place_id, target_day_id } — DELETE + INSERT; row id
       │        changes; cost/currency/time_slot/notes carried
       │      update: { place_id, cost_estimate?/time_slot?/notes? } —
       │        in-place UPDATE (CostBadge editing)
       │  • PATCH /api/trips/[id]/days/[dayId] — routing_profile cycle
       │      (walking → driving → cycling) and/or day notes (v1.22.0)
       │  • PATCH /api/trips/[id]/days/[dayId]/reorder — drag-and-drop reorder
       │  • POST /api/trips/[id]/swap-days — swap two days' day_number + date
       │  • PATCH /api/trips/[id] — party_size stepper (Zod whitelist, v1.22.0)
       │
       │  All invalidate ["trip", id] → detail re-fetches, Mapbox routes recompute
       ▼
7. (optional) Share the trip
       │  See [[share-flow]] — public payload strips cost/currency/party_size,
       │  honours routing_profile (v1.22.0).
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 1 | name, date range, optional list/places | new trip + N trip_days + 0..M trip_day_places |
| 3 | trip id | full nested trip + per-day Mapbox geometry |
| 5 | trip id | trip_day_places fully replaced based on algorithm |
| 6 | day-level mutation | trip_day_places mutated; trip detail refetches |

## Auto-plan algorithm

`src/lib/trip/auto-plan.ts`:

1. **K-means++ clustering.** Initialize k centroids (farthest-point seeding). Assign each place to the nearest centroid. Update centroids to cluster means. Repeat 8 iterations.
2. **Within-day category ordering.** Map each place's category to a bucket: `cafe(0) → park(1) → museum/shopping(2) → restaurant(4) → bar(5)`. Sort places within day by bucket value.
3. **Greedy nearest-neighbor.** Starting from the first place in the sorted order, repeatedly pick the closest unvisited place (haversine distance). Yields a reasonable walking/driving order.

Output is `trip_day_places` rows (since v1.22.0 with `cost_estimate/currency/time_slot/notes` carried by `place_id`). The Mapbox route geometry is computed on every GET — not persisted.

For the LLM-based alternative (geo/theme/opening-days grouping, time slots, day themes) see [[ai-trip-plan-flow]].

## Mapbox Directions usage

`src/lib/trip/directions.ts#getRoute(coords, profile, token?)`:

- One call per trip-day with ≥ 2 places, with the day's `routing_profile` (walking default / driving / cycling — NF-07, v1.22.0).
- Endpoint: `GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}`.
- Returns distance_km, duration_min, GeoJSON LineString, legs (converted inside the wrapper).
- Tracked as `mapbox_directions` at both call sites (trip detail: the user; shared view: the link owner) — v1.22.0, previously untracked.

Cost note: trip GET is hot; we still don't cache (v2). See [[../04-integrations/mapbox#cost--limits]].

## Failure modes

- **Step 1 (create):** Date sanity checks happen app-side; no DB CHECK. Bad dates can technically slip through but the UI prevents it.
- **Step 3 (get):** If a Mapbox call fails, that day's `route` is null but the rest renders.
- **Step 5 (auto-plan):** Re-running clobbers existing day assignments (cost/time_slot/notes survive since v1.22.0). UI confirms before re-running.
- **Step 6 (move place):** DELETE + INSERT means the row id changes (row fields carried since v1.22.0). Optimistic UI that tracks by id will need to refetch.

## Related code

- `src/app/(app)/trips/[id]/page.tsx` — the timeline + map page (v1.22.0: CostBadge, PartySizeControl, route-mode cycle button, AiPlanButton/Dialog).
- `src/lib/hooks/use-trips.ts` — all the mutation hooks (v1.22.0: +useUpdateTripDay, +useUpdateTripDayPlace, +useUpdateTrip).
- `src/components/map/map-view.tsx` — `routeLines` prop accepts day-colored polylines.
- `src/lib/trip/auto-plan.ts` — the algorithm.
- `src/lib/trip/directions.ts` — Mapbox wrapper (RoutingProfile param, v1.22.0).
- `src/lib/trip/cost-defaults.ts` — price_level → per-person USD defaults (v1.22.0).

## Open questions

- **Route caching.** Every detail GET hits Mapbox per day (now visible in the cost tracker via `mapbox_directions`). Persist the route on `trip_days.route` for stable trips? Trade-off: routes go stale when places move or the profile changes. Deferred to v2.
- **Date mutation reconciliation.** `PATCH /api/trips/[id]` allows date changes but doesn't reconcile `trip_days`. Decide policy.
- **Auto-plan respecting fixed times.** `time_slot` is still free-form text in the DB and the k-means auto-plan ignores it (it only preserves it). The AI planner assigns structured slots (morning/afternoon/evening/night) but a re-run doesn't pin user-edited ones.
- **Currency conversion.** `currency` defaults to USD everywhere; conversion/mixed-currency totals are v2.
