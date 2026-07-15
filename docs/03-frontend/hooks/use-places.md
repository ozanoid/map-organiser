---
title: usePlaces
type: hook
domain: frontend
version: 1.2.0
last_updated: 15.07.2026
status: stable
sources:
  - src/lib/hooks/use-places.ts
related:
  - "[[_README]]"
  - "[[use-filters]]"
  - "[[../../01-domain/places]]"
  - "[[../../02-backend/api-routes/places]]"
---

# `usePlaces` and family

> **v1.18.0:** `fetchPlaces` serializes `open_now=true`; `usePlaces` adds `refetchInterval: 60s` while the open-now filter is active (the list is a server-evaluated snapshot — the interval bounds its staleness).

The most-used hook in the app. Five exports: the main filtered list query plus four mutations.

## Signatures

```ts
function usePlaces(filters: PlaceFilters): UseQueryResult<Place[], Error>
function useParseLink(): UseMutationResult<ParsedPlaceData, Error, string>
function useCreatePlace(): UseMutationResult<Place, Error, CreatePlaceInput>
function useUpdateVisitStatus(): UseMutationResult<Place, Error, { placeId: string; visit_status: VisitStatus | null }>
function useRefreshGoogleData(): UseMutationResult<Place, Error, string>
```

## Behavior

| Hook | Source | Invalidates |
|---|---|---|
| `usePlaces(filters)` | `GET /api/places?...` with all `filters` keys serialized as query params. Query key `["places", filters]`. | — |
| `useParseLink` | `POST /api/places/parse-link` with `{ url }`. | — (write happens later via `useCreatePlace`) |
| `useCreatePlace` | `POST /api/places` with the full create input. | `["places"]` |
| `useUpdateVisitStatus` | `PATCH /api/places/[id]` with `{ visit_status }`. | `["places"]` |
| `useRefreshGoogleData` | `POST /api/places/[id]/refresh-google-data`. | `["places"]` |

## Query key shape

`["places", filters]` — the entire filters object is in the key. This means:

- **Pro:** every filter combination gets its own cache slot. Filter back-and-forth is instant.
- **Con:** lots of cache slots accumulate. The default `gcTime` (5 min, React Query default) collects them.
- **Tip:** when invalidating, use `queryClient.invalidateQueries({ queryKey: ["places"] })` (no second-level key) so every cached filter combination refetches.

## CreatePlaceInput shape

(From the source — verify against `src/lib/hooks/use-places.ts` if it drifts.)

```ts
type CreatePlaceInput = {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  country?: string;
  city?: string;
  category_id?: string;
  rating?: number;
  notes?: string;
  google_place_id?: string;
  google_data?: GooglePlaceData;
  photoRef?: string | null;
  source?: "manual" | "import" | "link";
  tag_ids?: string[];
  list_ids?: string[];
  visit_status?: VisitStatus | null;
};
```

## Consumers

- `src/app/(app)/places/page.tsx`
- `src/app/(app)/lists/[id]/page.tsx` (filtering within a list)
- `src/app/(app)/trips/[id]/page.tsx` (sourcing places for the "add to trip" picker)
- `src/components/map/map-content.tsx`
- `src/components/places/add-place-dialog.tsx` (uses `useParseLink` + `useCreatePlace`)

## Edge cases

- **Filter object identity.** Passing a fresh object literal on every render would force a refetch. The map page and places page pass the filters from `useFilters()`, which holds them in a state object — referentially stable until the filters actually change.
- **No optimistic updates.** Visit-status toggles wait for the round-trip. The map detail panel and place cards re-render after the cache invalidation.
- **No pagination.** All matching places come back in one response. With ~500 places per user this is fine; will hurt at 10K+.
- **Mutations don't update the cache directly** — they invalidate and let React Query refetch. Simpler, but a brief loading state shows up.
- **AI search trace context.** While an AI search is mid-flight, `fetchPlaces` attaches the search's W3C `traceparent` request header (read from `ai-search-store`) so the `/api/places` call joins the pipeline's single Honeycomb trace. Normal browsing fetches send no such header. See [[../../05-flows/observability-flow]].
