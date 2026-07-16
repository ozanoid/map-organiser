---
title: Trip
type: entity
domain: trips
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/hooks/use-trips.ts
  - src/lib/trip/auto-plan.ts
  - src/lib/trip/directions.ts
  - src/lib/trip/cost-defaults.ts
  - src/app/api/trips/route.ts
  - src/app/api/trips/[id]/route.ts
  - src/app/api/trips/[id]/auto-plan/route.ts
  - src/app/api/trips/[id]/days/[dayId]/route.ts
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
  - "[[../02-backend/api-routes/trips]]"
  - "[[../04-integrations/mapbox]]"
  - "[[../05-flows/trip-planning-flow]]"
  - "[[../05-flows/ai-trip-plan-flow]]"
---

# Trip

> **v1.22.0 (S4 Trip Intelligence):** per-day **route mode** (`trip_days.routing_profile`, NF-07), per-stop **budget estimates** (`trip_day_places.cost_estimate/currency` + `trips.party_size`, NF-08), and the **AI trip planner** (`POST /api/ai/trip-plan`, AI-09 — see [[../05-flows/ai-trip-plan-flow]]). `time_slot` and day/stop `notes` are rendered in the UI for the first time.

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
| `party_size` | int | yes | v1.22.0 (NF-08). Default `1`, CHECK 1–50. Budget totals multiply by this (costs are per-person). Stepper in the trip header; stripped from the public share payload. |
| `created_at` | timestamptz | yes | `default now()`. |
| `updated_at` | timestamptz | yes | `default now()`. |

### `trip_days`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `trip_id` | uuid | yes | FK → `trips.id`. |
| `day_number` | int | yes | 1-indexed sequential position within the trip. |
| `date` | date | yes | Concrete calendar date. Should match `start_date + (day_number - 1)`. |
| `notes` | text | no | Day-level notes. AI planner writes `"{theme} — {rationale}"` here (v1.22.0); rendered under the day header. |
| `routing_profile` | text | yes | v1.22.0 (NF-07). Default `'walking'`, CHECK walking/driving/cycling. The Mapbox Directions profile for this day's route; cycle button in the day header. |
| `created_at` | timestamptz | yes | — |

### `trip_day_places`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `trip_day_id` | uuid | yes | FK → `trip_days.id`. |
| `place_id` | uuid | yes | FK → `places.id` **with `ON DELETE CASCADE`** (migration `add_cascade_delete_trip_day_places_place_id`). |
| `sort_order` | int | no | Within-day order. Default 0. |
| `time_slot` | text | no | Free-form (e.g. `"morning"`, `"14:00"`); not DB-constrained. AI planner writes morning/afternoon/evening/night; rendered as a chip on the place row (v1.22.0). |
| `notes` | text | no | Per-stop notes. AI planner writes an optional one-line reason (v1.22.0). |
| `cost_estimate` | numeric | no | v1.22.0 (NF-08). **Per-person** estimate; seeded from `google_data.price_level` (`defaultCostEstimate`: 1→$10, 2→$25, 3→$50, 4→$90), inline-editable via CostBadge. Null when no price_level and not edited. |
| `currency` | text | no | v1.22.0 (NF-08). Default `'USD'`. Conversion deferred (v2). |
| `created_at` | timestamptz | yes | — |

### Joined types (`Trip` interface)

`Trip` in `src/lib/types/index.ts` includes `party_size: number` plus optional joins:

- `days?: TripDay[]`
- `day_count?: number`
- `place_count?: number`

`RoutingProfile` (v1.22.0) is exported from the same file: `"walking" | "driving" | "cycling"` — must stay in sync with the `trip_days.routing_profile` DB CHECK.

`TripDay` adds `routing_profile: RoutingProfile` plus:

- `places?: TripDayPlace[]`
- `route?: { distance_km, duration_min, geometry: GeoJSON LineString, legs?: [...] }` — set by `GET /api/trips/[id]` after calling Mapbox Directions per day.

`TripDayPlace` adds `cost_estimate: number | null` and `currency: string | null` plus:

- `place?: Place` — the joined place row.

## Invariants

- **`start_date ≤ end_date`.** Enforced by the API on create/update (no DB check).
- **`day_number` is unique within a trip** (no DB unique constraint observed — relies on app discipline).
- **`day_number` and `date` move together.** Swapping days (`/api/trips/[id]/swap-days`) swaps both `day_number` and `date` so the position-vs-calendar mapping stays consistent.
- **`sort_order` is dense and 0-based per day** (set by the reorder endpoint). Adding a new place appends at `MAX(sort_order) + 1`.
- **Place deletion cascades into the trip.** Deleting a Place silently removes its `trip_day_places` rows. The bulk-delete UI runs `check_trips` to warn first.
- **Route geometry is recomputed on every GET.** It's not persisted — Mapbox Directions is hit per day (with that day's `routing_profile`) every time the trip detail loads. Only called for days with ≥ 2 places; tracked as `mapbox_directions` since v1.22.0.
- **Rewrites preserve row fields (v1.22.0).** Every delete+insert path over `trip_day_places` (move between days, auto-plan, AI plan) snapshots and carries `cost_estimate/currency/time_slot/notes` by `place_id` — before v1.22.0 a move or re-plan silently destroyed them.
- **Costs are per-person.** Day totals and the trip header total are `Σ cost_estimate`; the header multiplies by `party_size` (`≈ $X` with a per-person tooltip).

## Lifecycle

```
   ┌──────────────────────────────────────────────────┐
   │  POST /api/trips                                  │
   │  • Creates trip                                   │
   │  • Creates trip_days for every date in range      │
   │  • Optionally copies places from list_id          │
   │    (cost_estimate seeded from price_level)        │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ optional (either path)
   ┌──────────────────────────────────────────────────┐
   │  POST /api/trips/[id]/auto-plan                   │
   │  • K-means++ cluster places by lat/lng (k=days)   │
   │  • Sort within day by category preference         │
   │  • Order via greedy nearest-neighbor              │
   │  • Persist as trip_day_places (carries cost/      │
   │    time_slot/notes by place_id, v1.22.0)          │
   │  — OR —                                           │
   │  POST /api/ai/trip-plan (AI-09, v1.22.0)          │
   │  • LLM distributes ≤40 candidates by geo/theme/   │
   │    opening days; time_slot + note per stop;       │
   │    theme+rationale → trip_days.notes              │
   │  • Delete-after-validate; costs carried by id     │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ manual edits
   ┌──────────────────────────────────────────────────┐
   │  Per-day mutations                                │
   │  • POST /days/[dayId]/places  → add (cost seeded) │
   │  • PATCH /days/[dayId]/reorder → drag-drop order  │
   │  • PATCH /days/[dayId] → routing_profile / notes  │
   │  • PATCH /days/[dayId]/places → move across days  │
   │    (DELETE+INSERT, fields carried) or in-place    │
   │    update (cost_estimate / time_slot / notes)     │
   │  • Up/down arrows → POST /swap-days               │
   │  • PATCH /api/trips/[id] → party_size stepper     │
   └────────────────┬─────────────────────────────────┘
                    │
                    ▼ render
   ┌──────────────────────────────────────────────────┐
   │  GET /api/trips/[id]                              │
   │  • Loads trip + days + places                     │
   │  • Calls Mapbox Directions for every day ≥ 2 stops│
   │    with day.routing_profile (tracked SKU)         │
   │  • Returns route geometry + distance + duration   │
   └──────────────────────────────────────────────────┘
```

## Auto-plan algorithm

Lives in `src/lib/trip/auto-plan.ts`. Three stages:

1. **Cluster by location.** K-means++ with `k = trip.day_count`, 8 iterations, k-means++ initialization (pick farthest points as seeds).
2. **Sort within day by category type.** Hand-tuned order: `cafe(0) → park(1) → museum/shopping(2) → restaurant(4) → bar(5)`. Maps Place categories onto these buckets.
3. **Route via nearest-neighbor.** Greedy: starting from the first place in the sorted order, repeatedly pick the closest unvisited place by haversine distance.

Output is persisted as `trip_day_places` rows; the algorithm doesn't return route geometry — that's a separate Mapbox call on GET. Since v1.22.0 the rewrite carries `cost_estimate/currency/time_slot/notes` per place.

**AI alternative (v1.22.0):** `POST /api/ai/trip-plan` augments (doesn't replace) auto-plan — LLM grouping by geography/theme/opening-days with per-stop time slots and per-day theme+rationale. See [[../05-flows/ai-trip-plan-flow]] and [[../02-backend/api-routes/ai#post-apiaitrip-plan]].

## Mapbox Directions integration

Lives in `src/lib/trip/directions.ts` — `getRoute(coords, profile, token?)`. One request per multi-stop day per `GET /api/trips/[id]` (and per shared-trip view):

- Endpoint: `GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}`.
- **Profile comes from `trip_days.routing_profile`** (NF-07, v1.22.0): walking (default) / driving / cycling, switchable per day via the day-header cycle button (`PATCH /api/trips/[id]/days/[dayId]`). The `RoutingProfile` union and the DB CHECK must stay in sync.
- The wrapper converts to km (1 decimal) / whole minutes and returns GeoJSON `LineString` geometry plus per-leg breakdowns; assigned to `TripDay.route`. Max 25 waypoints.
- **Tracked since v1.22.0:** every call increments the `mapbox_directions` SKU ($2/1k past 100k free); on the shared view the call is attributed to the link owner. Previously fully untracked.

**Cost note.** Mapbox Directions free tier is 100K requests/month. Each trip view burns 1 request per day with ≥2 stops. A 10-trip session with avg 5 days = 50 requests. Headroom is large but worth caching if a viral share doc balloons traffic — still no cache in v1.22.0 (v2).

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
| `POST` | `/api/trips` | Create + materialize days (optionally seed from list; costs seeded from price_level). |
| `GET` | `/api/trips/[id]` | Detail with days + places + per-day Mapbox route (per-day `routing_profile`). |
| `PATCH` | `/api/trips/[id]` | Update trip metadata — Zod whitelist (v1.22.0): name, dates, color, notes, `party_size`, list_id. |
| `DELETE` | `/api/trips/[id]` | Delete trip (cascade to days, day places). |
| `POST` | `/api/trips/[id]/auto-plan` | Re-run auto-plan (carries row fields, v1.22.0). |
| `POST` | `/api/trips/[id]/swap-days` | Swap two days' `day_number` + `date`. |
| `PATCH` | `/api/trips/[id]/days/[dayId]` | v1.22.0 — update one day: `routing_profile` and/or `notes`. |
| `POST` | `/api/trips/[id]/days/[dayId]/places` | Add a place to a day (seeds `cost_estimate`). |
| `DELETE` | `/api/trips/[id]/days/[dayId]/places` | Remove a place from a day. |
| `PATCH` | `/api/trips/[id]/days/[dayId]/places` | Move to another day (DELETE+INSERT, fields carried) OR in-place update of `cost_estimate`/`time_slot`/`notes` (v1.22.0). |
| `PATCH` | `/api/trips/[id]/days/[dayId]/reorder` | Reorder places within a day. |
| `POST` | `/api/ai/trip-plan` | v1.22.0 — AI full-rewrite plan (documented under [[../02-backend/api-routes/ai]]). |

## Frontend code surface

- **Hook bundle:** `src/lib/hooks/use-trips.ts` — 13 exports (see [[../03-frontend/hooks/use-trips]]); v1.22.0 added `useUpdateTripDay`, `useUpdateTripDayPlace`, `useUpdateTrip`. Query keys `["trips"]` (list) and `["trip", tripId]` (detail).
- **Detail page:** `src/app/(app)/trips/[id]/page.tsx` — timeline + map split layout. v1.22.0 in-file components: `CostBadge` (inline per-person cost chip, click-to-edit), `PartySizeControl` (header stepper 1–50; header total = per-person Σ × party_size), route-mode cycle button in the day header (Footprints/Car/Bike icons), `AiPlanButton` + `AiPlanDialog` (ai-settings-gated; pool checkbox + city input). `day.notes` (italic under the day header) and `time_slot` (chip on the place row) render for the first time.
- **Lists tab integration:** `src/app/(app)/lists/page.tsx` exposes a "My Trips" tab next to "My Lists".
- **Map rendering:** `MapView` accepts a `routeLines` prop and draws day-colored polylines per `TripDay.route.geometry`.

## Open questions

- **Date drift on swap.** Swapping `day_number` + `date` is the right move when reordering days, but adding a day in the middle or shortening the trip could leave gaps in `day_number`. Worth a code audit before adding a "duplicate trip" feature.
- **Auto-plan idempotency.** Re-running auto-plan replaces existing assignments — confirm the route handler clears `trip_day_places` first before reinserting.
