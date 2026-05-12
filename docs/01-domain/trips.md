---
title: Trip
type: entity
domain: trips
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/hooks/use-trips.ts
  - src/lib/trip/auto-plan.ts
  - src/lib/trip/directions.ts
  - src/app/api/trips/route.ts
  - src/app/api/trips/[id]/route.ts
  - src/app/api/trips/[id]/auto-plan/route.ts
  - src/app/api/trips/[id]/days/[dayId]/places/route.ts
  - src/app/api/trips/[id]/days/[dayId]/reorder/route.ts
  - src/app/api/trips/[id]/swap-days/route.ts
  - src/app/(app)/trips/[id]/page.tsx
  - src/app/(app)/lists/page.tsx
related:
  - "[[places]]"
  - "[[lists]]"
  - "[[sharing]]"
  - "[[../02-backend/schema/trips]]"
  - "[[../02-backend/schema/trip_days]]"
  - "[[../02-backend/schema/trip_day_places]]"
  - "[[../04-integrations/mapbox]]"
---

# Trip

A date-ranged plan. A trip owns a set of **Trip Days** (one per calendar day), each holding ordered **Trip Day Places**. Trips are typically built from a List but don't have to be.

This page covers all three rows of the trip data model: `trips`, `trip_days`, `trip_day_places`.

## Shape

### `trips`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. RLS-scoped. |
| `list_id` | uuid | no | FK → `lists.id`. Optional source list. |
| `name` | text | yes | — |
| `start_date` | date | yes | Inclusive. |
| `end_date` | date | yes | Inclusive. Day count = `end_date - start_date + 1`. |
| `color` | text | no | Hex like `'#059669'`. Default emerald. Used for trip badges. |
| `notes` | text | no | Free-form. |
| `created_at` | timestamptz | yes | `default now()`. |
| `updated_at` | timestamptz | yes | `default now()`. |

### `trip_days`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `trip_id` | uuid | yes | FK → `trips.id`. |
| `day_number` | int | yes | 1-indexed sequential position within the trip. |
| `date` | date | yes | Concrete calendar date. Should match `start_date + (day_number - 1)`. |
| `notes` | text | no | Day-level notes. |
| `created_at` | timestamptz | yes | — |

### `trip_day_places`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `trip_day_id` | uuid | yes | FK → `trip_days.id`. |
| `place_id` | uuid | yes | FK → `places.id` **with `ON DELETE CASCADE`** (migration `add_cascade_delete_trip_day_places_place_id`). |
| `sort_order` | int | no | Within-day order. Default 0. |
| `time_slot` | text | no | Free-form (e.g. `"morning"`, `"14:00"`); not currently constrained. |
| `notes` | text | no | Per-stop notes. |
| `created_at` | timestamptz | yes | — |

### Joined types (`Trip` interface)

`Trip` in `src/lib/types/index.ts` includes optional joins:

- `days?: TripDay[]`
- `day_count?: number`
- `place_count?: number`

`TripDay` adds:

- `places?: TripDayPlace[]`
- `route?: { distance_km, duration_min, geometry: GeoJSON LineString, legs?: [...] }` — set by `GET /api/trips/[id]` after calling Mapbox Directions per day.

`TripDayPlace` adds:

- `place?: Place` — the joined place row.

## Invariants

- **`start_date ≤ end_date`.** Enforced by the API on create/update (no DB check).
- **`day_number` is unique within a trip** (no DB unique constraint observed — relies on app discipline).
- **`day_number` and `date` move together.** Swapping days (`/api/trips/[id]/swap-days`) swaps both `day_number` and `date` so the position-vs-calendar mapping stays consistent.
- **`sort_order` is dense and 0-based per day** (set by the reorder endpoint). Adding a new place appends at `MAX(sort_order) + 1`.
- **Place deletion cascades into the trip.** Deleting a Place silently removes its `trip_day_places` rows. The bulk-delete UI runs `check_trips` to warn first.
- **Route geometry is recomputed on every GET.** It's not persisted — Mapbox Directions is hit per day every time the trip detail loads. Only called for days with ≥ 2 places.

## Lifecycle

```
   ┌──────────────────────────────────────────────────┐
   │  POST /api/trips                                  │
   │  • Creates trip                                   │
   │  • Creates trip_days for every date in range      │
   │  • Optionally copies places from list_id          │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ optional
   ┌──────────────────────────────────────────────────┐
   │  POST /api/trips/[id]/auto-plan                   │
   │  • K-means++ cluster places by lat/lng (k=days)   │
   │  • Sort within day by category preference         │
   │  • Order via greedy nearest-neighbor              │
   │  • Persist as trip_day_places                     │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ manual edits
   ┌──────────────────────────────────────────────────┐
   │  Per-day mutations                                │
   │  • POST /days/[dayId]/places  → add               │
   │  • PATCH /days/[dayId]/reorder → drag-drop order  │
   │  • Move dropdown → DELETE + INSERT across days    │
   │  • Up/down arrows → POST /swap-days               │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ render
   ┌──────────────────────────────────────────────────┐
   │  GET /api/trips/[id]                              │
   │  • Loads trip + days + places                     │
   │  • Calls Mapbox Directions for every day ≥ 2 stops│
   │  • Returns route geometry + distance + duration   │
   └──────────────────────────────────────────────────┘
```

## Auto-plan algorithm

Lives in `src/lib/trip/auto-plan.ts`. Three stages:

1. **Cluster by location.** K-means++ with `k = trip.day_count`, 8 iterations, k-means++ initialization (pick farthest points as seeds).
2. **Sort within day by category type.** Hand-tuned order: `cafe(0) → park(1) → museum/shopping(2) → restaurant(4) → bar(5)`. Maps Place categories onto these buckets.
3. **Route via nearest-neighbor.** Greedy: starting from the first place in the sorted order, repeatedly pick the closest unvisited place by haversine distance.

Output is persisted as `trip_day_places` rows; the algorithm doesn't return route geometry — that's a separate Mapbox call on GET.

## Mapbox Directions integration

Lives in `src/lib/trip/directions.ts`. One request per day per `GET /api/trips/[id]`:

- Endpoint: `GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}`.
- Default profile likely `walking` or `driving` — verify in code if unclear.
- Response carries distance (m), duration (s), GeoJSON `LineString` geometry, and per-leg breakdowns.
- App converts to km/min and assigns to `TripDay.route`.

**Cost note.** Mapbox Directions free tier is 100K requests/month. Each trip view burns 1 request per day with ≥2 stops. A 10-trip session with avg 5 days = 50 requests. Headroom is large but worth caching if a viral share doc balloons traffic.

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `trips.user_id` FK |
| [[lists\|List]] | N:1 (optional) | `trips.list_id` FK |
| Trip Day | 1:N | `trip_days.trip_id` FK |
| Trip Day Place | 1:N (via Trip Day) | `trip_day_places.trip_day_id` FK |
| [[places\|Place]] | M:N via Trip Day Place | `trip_day_places.place_id` FK (CASCADE delete) |
| [[sharing\|Shared Link]] | 0..N | `shared_links.resource_type = 'trip'`, `resource_id = trips.id` |

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/trips` | List user's trips. |
| `POST` | `/api/trips` | Create + materialize days (optionally seed from list). |
| `GET` | `/api/trips/[id]` | Detail with days + places + per-day Mapbox route. |
| `PATCH` | `/api/trips/[id]` | Update trip metadata (name, dates, color, notes). |
| `DELETE` | `/api/trips/[id]` | Delete trip (cascade to days, day places). |
| `POST` | `/api/trips/[id]/auto-plan` | Re-run auto-plan. |
| `POST` | `/api/trips/[id]/swap-days` | Swap two days' `day_number` + `date`. |
| `POST` | `/api/trips/[id]/days/[dayId]/places` | Add a place to a day. |
| `DELETE` | `/api/trips/[id]/days/[dayId]/places` | Remove (also used to move between days as DELETE-then-INSERT). |
| `PATCH` | `/api/trips/[id]/days/[dayId]/reorder` | Reorder places within a day. |

## Frontend code surface

- **Hook bundle:** `src/lib/hooks/use-trips.ts` exports several hooks (trip list, trip detail, mutations). Query keys `["trips"]` (list) and `["trip", tripId]` (detail).
- **Detail page:** `src/app/(app)/trips/[id]/page.tsx` — timeline + map split layout.
- **Lists tab integration:** `src/app/(app)/lists/page.tsx` exposes a "My Trips" tab next to "My Lists".
- **Map rendering:** `MapView` accepts a `routeLines` prop and draws day-colored polylines per `TripDay.route.geometry`.

## Open questions

- **Date drift on swap.** Swapping `day_number` + `date` is the right move when reordering days, but adding a day in the middle or shortening the trip could leave gaps in `day_number`. Worth a code audit before adding a "duplicate trip" feature.
- **Auto-plan idempotency.** Re-running auto-plan replaces existing assignments — confirm the route handler clears `trip_day_places` first before reinserting.
