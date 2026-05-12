---
title: Trip Planning Flow
type: flow
domain: trips
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
  - src/lib/trip/auto-plan.ts
  - src/lib/trip/directions.ts
  - src/app/(app)/trips/[id]/page.tsx
related:
  - "[[../01-domain/trips]]"
  - "[[../02-backend/api-routes/trips]]"
  - "[[../04-integrations/mapbox]]"
---

# Trip Planning Flow

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
       │    (auto-plan will redistribute later)
       │
       ▼  React Query invalidates ["trips"]
2. Navigate to /trips/[id]
       │
       ▼
3. GET /api/trips/[id]
       │  • SELECT trip + trip_days + trip_day_places + places + categories
       │  • For each day with ≥ 2 places: getRoute(coords) → Mapbox Directions
       │  • Return Trip with days[].places[] and days[].route
       │
       ▼  React Query caches under ["trip", id]
4. Trip detail page renders: timeline + map
       │  • Timeline: ordered list of days, each with reorderable place rows
       │  • Map: day-colored polylines + place markers + day-selector pills
       │
       ▼  (optional — user clicks "Auto-plan")
5. POST /api/trips/[id]/auto-plan
       │  • Aggregate all distinct places across the trip
       │  • Run autoPlanTrip(places, dayCount):
       │      a. K-means++ cluster (k = dayCount), 8 iterations
       │      b. Sort within day by category preference
       │         (cafe → park → museum/shopping → restaurant → bar)
       │      c. Greedy nearest-neighbor within day (haversine)
       │  • DELETE all trip_day_places for the trip
       │  • INSERT new placements
       │
       ▼  React Query invalidates ["trip", id] → routes refetch
       │
       ▼  (per-day mutations: add / remove / reorder / move / swap-days)
6. Day-level interactions
       │  • POST /api/trips/[id]/days/[dayId]/places — add a place
       │  • DELETE /api/trips/[id]/days/[dayId]/places — remove a place
       │  • PATCH /api/trips/[id]/days/[dayId]/places — move to another day
       │      (server: DELETE + INSERT; the row id changes)
       │  • PATCH /api/trips/[id]/days/[dayId]/reorder — drag-and-drop reorder
       │  • POST /api/trips/[id]/swap-days — swap two days' day_number + date
       │
       │  All invalidate ["trip", id] → detail re-fetches, Mapbox routes recompute
       ▼
7. (optional) Share the trip
       │  See [[share-flow]].
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

Output is `trip_day_places` rows. The Mapbox route geometry is computed on every GET — not persisted.

## Mapbox Directions usage

`src/lib/trip/directions.ts#getRoute(coords, profile)`:

- One call per trip-day with ≥ 2 places.
- Endpoint: `GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}`.
- Returns distance, duration, GeoJSON LineString, legs.

Cost note: trip GET is hot; we don't cache. See [[../04-integrations/mapbox#cost--limits]].

## Failure modes

- **Step 1 (create):** Date sanity checks happen app-side; no DB CHECK. Bad dates can technically slip through but the UI prevents it.
- **Step 3 (get):** If a Mapbox call fails, that day's `route` is null but the rest renders.
- **Step 5 (auto-plan):** Re-running clobbers existing assignments. UI confirms before re-running.
- **Step 6 (move place):** DELETE + INSERT means the row id changes. Optimistic UI that tracks by id will need to refetch.

## Related code

- `src/app/(app)/trips/[id]/page.tsx` — the timeline + map page.
- `src/lib/hooks/use-trips.ts` — all the mutation hooks.
- `src/components/map/map-view.tsx` — `routeLines` prop accepts day-colored polylines.
- `src/lib/trip/auto-plan.ts` — the algorithm.
- `src/lib/trip/directions.ts` — Mapbox wrapper.

## Open questions

- **Route caching.** Every detail GET hits Mapbox per day. Persist the route on `trip_days.route` for stable trips? Trade-off: routes go stale when places move.
- **Date mutation reconciliation.** `PATCH /api/trips/[id]` allows date changes but doesn't reconcile `trip_days`. Decide policy.
- **Auto-plan respecting fixed times.** Today `time_slot` is free-form text; auto-plan ignores it. If it becomes a structured field, the algorithm should pin those places.
