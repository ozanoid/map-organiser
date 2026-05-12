---
title: useTrips
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-trips.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/trips]]"
  - "[[../../02-backend/api-routes/trips]]"
---

# `useTrips` and family

Ten exports — the most surface of any hook file. Two queries (list + detail) and eight mutations covering trip CRUD plus per-day-place operations.

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
| `useMoveTripPlace` | `PATCH /api/trips/[id]/days/[dayId]/places` (with `target_day_id`) | `["trip", tripId]` |
| `useSwapTripDays` | `POST /api/trips/[id]/swap-days` | `["trip", tripId]` |

## Query keys

- `["trips"]` — the user's list of trips (no days/places).
- `["trip", id]` — full detail with days, places, and Mapbox route geometry.

Note: trip detail mutations invalidate `["trip", tripId]` **specifically**, not `["trips"]`. The trips list view shows counts but doesn't depend on day-level data, so a day-place mutation doesn't need to refetch it.

## Consumers

- `src/app/(app)/trips/[id]/page.tsx` — `useTrip`, all 8 mutations.
- `src/app/(app)/lists/page.tsx` — `useTrips` (for the My Trips tab).

## Edge cases

- **Auto-plan refetch.** Returns `unknown` (no shape contract on the response). The hook invalidates `["trip", tripId]`, so the detail view refetches with the new day-place assignments.
- **Move place across days.** `useMoveTripPlace` uses PATCH with a `target_day_id` body field. The server implements this as DELETE-then-INSERT (the row's `id` changes — see [[../../02-backend/api-routes/trips#patch-apitripsiddaysdayidplaces]]). The hook abstracts this.
- **Swap days.** Modifies two `trip_days` rows atomically (swaps `day_number` + `date`). Invalidates the detail query.
- **No optimistic updates anywhere** — all mutations wait for the round-trip. Combined with Mapbox Directions on every detail fetch, day-place mutations can feel sluggish on slower connections. A future optimization would optimistically reorder + reuse cached route geometry.
