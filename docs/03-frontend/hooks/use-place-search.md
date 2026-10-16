---
title: usePlaceSearch
type: hook
domain: frontend
version: 1.1.1
last_updated: 16.10.2026
status: stable
sources:
  - src/lib/hooks/use-place-search.ts
  - src/components/map/search-box.tsx
related:
  - "[[_README]]"
  - "[[use-debounce]]"
  - "[[../components/map]]"
  - "[[../../02-backend/api-routes/search]]"
  - "[[../../04-integrations/mapbox]]"
---

# `usePlaceSearch`

Mapbox Search Box client hook. Backs the search-on-map flow: debounced autocomplete + result retrieval + session-token lifecycle.

## Signature

```ts
function usePlaceSearch(opts?: {
  proximity?: { lng: number; lat: number };
  bbox?: [number, number, number, number]; // v1.28.1 — only results inside
}): {
  query: string;
  setQuery: (q: string) => void;
  suggestions: SearchSuggestion[];      // empty when query < 2 chars
  isSearching: boolean;
  retrieve: (mapboxId: string) => Promise<RetrievedPlaceData>;
  isRetrieving: boolean;
  retrieveError: Error | null;
  clear: () => void;
};

export interface RetrievedPlaceData extends ParsedPlaceData {
  _provider: "dataforseo" | "mapbox";
  _mapbox_id: string;
  _fetchTimeMs: number;
  _extended?: Partial<GooglePlaceData>;
  lite_profile?: PlaceProfile | null;  // v1.22.1 — heuristic AI suggestions
}
```

## Behavior

- **Debounce:** 300ms via `useDebouncedCallback`. Query bumps only after the user stops typing.
- **Min length:** 2 chars. Below that, hook returns empty suggestions and skips `/suggest`.
- **Session token (UUIDv4):**
  - Minted on hook init.
  - **Rotated on successful retrieve** (Mapbox closes the session).
  - **Rotated after 180s inactivity** (Mapbox session expiry, checked by interval timer).
  - **Rotated after 50 consecutive suggest calls** (Mapbox cap).
- **React Query keys:**
  - Suggest: `["place-search", "suggest", debouncedQuery, proximity, bbox]`, `staleTime: 30s`.
  - Retrieve: mutation, no cache key.

## Endpoints called

- `GET /api/search/suggest?q=...&session_token=...&proximity=...[&bbox=...]`
- `GET /api/search/retrieve/{mapboxId}?session_token=...`

See [[../../02-backend/api-routes/search]].

## Consumers

- `src/components/map/search-box.tsx` (only consumer today). It passes
  `proximity` (v1.28.1): the point an Instagram hand-off aimed the search at,
  else the viewport center `MapContent` hands it. An aimed search also passes
  `bbox`, about 30 km around that point: proximity only ranks, so a strong name
  match on another continent would still come first.

## Edge cases

- **`crypto.randomUUID`** is used for the session token where available. A `Math.random` fallback exists for legacy environments — present but practically unreachable in our Next.js 16 deployment.
- **Stale proximity:** `proximity` is part of the suggest query key, so a new point refetches the open suggestions. `MapContent` keeps it stable: the viewport center is rounded to 0.01° (about 1 km) and the same object is kept while the rounded value is unchanged, so only a pan of roughly a kilometre or more refetches. A caller that built a fresh `{lng, lat}` on every render would refetch every time.
- **Concurrent retrieve attempts:** `react-query` `mutateAsync` serializes per hook instance; this matches the user flow (one selection at a time).
- **No optimistic updates** — retrieve is awaited before the result panel opens.

## Open questions

- **Server fan-out for retrieve.** The retrieve endpoint optionally calls DataForSEO; the hook surfaces the unified shape but a future split (Mapbox-only retrieve + on-demand enrich button) might give the user explicit control.
