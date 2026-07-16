---
title: useTrips
type: hook
domain: frontend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - src/lib/hooks/use-trips.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/trips]]"
  - "[[../../02-backend/api-routes/trips]]"
---

# `useTrips` and family

Thirteen exports — the most surface of any hook file. Two queries (list + detail) and eleven mutations covering trip CRUD plus per-day and per-day-place operations. v1.22.0 (S4 NF-07/NF-08) added `useUpdateTripDay`, `useUpdateTripDayPlace`, and `useUpdateTrip`.

## Signatures

```ts
function useTrips(): UseQueryResult<Trip[], Error>
function useTrip(id: string | undefined): UseQueryResult<Trip, Error>

function useCreateTrip(): UseMutationResult<
  Trip,
  Error,
  { name: string; start_date: string; end_date: string; list_id?: string; place_ids?: string[] }
>

function useDeleteTrip(): UseMutationResult<void, Error, string>

function useAutoPlan(): UseMutationResult<unknown, Error, string>  // tripId

function useReorderTripDayPlaces(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; placeIds: string[] }
>

function useRemoveTripPlace(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; placeId: string }
>

function useAddTripPlace(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; placeId: string }
>

function useMoveTripPlace(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; placeId: string; targetDayId: string }
>

function useSwapTripDays(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; direction: "up" | "down" }
>

// v1.22.0 (NF-07/AI-09): patch a single trip day
function useUpdateTripDay(): UseMutationResult<
  unknown,  // the updated trip_days row
  Error,
  { tripId: string; dayId: string; routing_profile?: "walking" | "driving" | "cycling"; notes?: string | null }
>

// v1.22.0 (NF-08): in-place update of a trip-day place row
function useUpdateTripDayPlace(): UseMutationResult<
  void,
  Error,
  { tripId: string; dayId: string; placeId: string; cost_estimate?: number | null; time_slot?: string | null; notes?: string | null }
>

// v1.22.0 (NF-08): update trip fields
function useUpdateTrip(): UseMutationResult<
  Trip,
  Error,
  { tripId: string; name?: string; notes?: string | null; party_size?: number }
>
```

## Behavior

| Hook | Endpoint | Invalidates |
|---|---|---|
| `useTrips()` | `GET /api/trips` | — |
| `useTrip(id)` | `GET /api/trips/[id]` (enabled if id) | — |
| `useCreateTrip` | `POST /api/trips` | `["trips"]` |
| `useDeleteTrip` | `DELETE /api/trips/[id]` | `["trips"]` |
| `useAutoPlan` | `POST /api/trips/[id]/auto-plan` | `["trip", tripId]` |
| `useReorderTripDayPlaces` | `PATCH /api/trips/[id]/days/[dayId]/reorder` | `["trip", tripId]` |
| `useRemoveTripPlace` | `DELETE /api/trips/[id]/days/[dayId]/places` | `["trip", tripId]` |
| `useAddTripPlace` | `POST /api/trips/[id]/days/[dayId]/places` | `["trip", tripId]` |
| `useMoveTripPlace` | `PATCH /api/trips/[id]/days/[dayId]/places` (move shape: `target_day_id`) | `["trip", tripId]` |
| `useSwapTripDays` | `POST /api/trips/[id]/swap-days` | `["trip", tripId]` |
| `useUpdateTripDay` (v1.22.0) | `PATCH /api/trips/[id]/days/[dayId]` | `["trip", tripId]` |
| `useUpdateTripDayPlace` (v1.22.0) | `PATCH /api/trips/[id]/days/[dayId]/places` (update shape: `place_id` + fields) | `["trip", tripId]` |
| `useUpdateTrip` (v1.22.0) | `PATCH /api/trips/[id]` | `["trip", tripId]` **and** `["trips"]` |

## Query keys

- `["trips"]` — the user's list of trips (no days/places).
- `["trip", id]` — full detail with days, places, and Mapbox route geometry.

Note: trip detail mutations invalidate `["trip", tripId]` **specifically**, not `["trips"]`. The trips list view shows counts but doesn't depend on day-level data, so a day-place mutation doesn't need to refetch it. The exception is `useUpdateTrip` (v1.22.0), which invalidates **both** — trip-level fields like `name`/`party_size` do surface in the list view.

## Consumers

- `src/app/(app)/trips/[id]/page.tsx` — `useTrip`, all 11 mutations (v1.22.0: `useUpdateTripDay` powers the day-header route-mode cycle button, `useUpdateTripDayPlace` the inline CostBadge editor, `useUpdateTrip` the PartySizeControl stepper).
- `src/app/(app)/lists/page.tsx` — `useTrips` (for the My Trips tab).

## Edge cases

- **Auto-plan refetch.** Returns `unknown` (no shape contract on the response). The hook invalidates `["trip", tripId]`, so the detail view refetches with the new day-place assignments.
- **Move place across days.** `useMoveTripPlace` uses PATCH with a `target_day_id` body field. The server implements this as DELETE-then-INSERT (the row's `id` changes; `cost_estimate/currency/time_slot/notes` are carried since v1.22.0 — see [[../../02-backend/api-routes/trips#patch-apitripsiddaysdayidplaces]]). The hook abstracts this.
- **One route, two hooks.** `useMoveTripPlace` and `useUpdateTripDayPlace` both PATCH `/days/[dayId]/places` — the server disambiguates by body shape (`target_day_id` present = move; otherwise in-place update).
- **Swap days.** Modifies two `trip_days` rows atomically (swaps `day_number` + `date`). Invalidates the detail query.
- **No optimistic updates anywhere** — all mutations wait for the round-trip. Combined with Mapbox Directions on every detail fetch, day-place mutations can feel sluggish on slower connections. A future optimization would optimistically reorder + reuse cached route geometry.
