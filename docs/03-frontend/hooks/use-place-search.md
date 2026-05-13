---
title: usePlaceSearch
type: hook
domain: frontend
version: 1.0.0
last_updated: 13.05.2026
status: stable
sources:
  - src/lib/hooks/use-place-search.ts
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
  - Suggest: `["place-search", "suggest", debouncedQuery, proximity]`, `staleTime: 30s`.
  - Retrieve: mutation, no cache key.

## Endpoints called

- `GET /api/search/suggest?q=...&session_token=...&proximity=...`
- `GET /api/search/retrieve/{mapboxId}?session_token=...`

See [[../../02-backend/api-routes/search]].

## Consumers

- `src/components/map/search-box.tsx` (only consumer today).

## Edge cases

- **`crypto.randomUUID`** is used for the session token where available. A `Math.random` fallback exists for legacy environments — present but practically unreachable in our Next.js 16 deployment.
- **Stale proximity:** if the caller passes a fresh `{lng, lat}` object on every render, the query key changes and refetches. Today no caller does this; the SearchBox component doesn't pass `proximity` at all (global search). If proximity is added, memoize the object.
- **Concurrent retrieve attempts:** `react-query` `mutateAsync` serializes per hook instance; this matches the user flow (one selection at a time).
- **No optimistic updates** — retrieve is awaited before the result panel opens.

## Open questions

- **Proximity bias not wired yet.** When the user is zoomed into Tokyo, the Mapbox API doesn't know that. Plumbing `MapViewHandle.getCenter()` through to this hook would localize results.
- **Server fan-out for retrieve.** The retrieve endpoint optionally calls DataForSEO; the hook surfaces the unified shape but a future split (Mapbox-only retrieve + on-demand enrich button) might give the user explicit control.
