---
title: Hooks
type: overview
domain: frontend
version: 1.1.0
last_updated: 13.05.2026
status: stable
sources:
  - src/lib/hooks/
related:
  - "[[../state-management]]"
  - "[[../_README]]"
---

# Hooks

Every custom hook lives in `src/lib/hooks/`. Convention: file `use-x.ts` exports `useX` (and related mutation/sub-query hooks where applicable).

## Index

| Hook | Flavor | Query key | Doc |
|---|---|---|---|
| `useCategories` | react-query | `["categories"]` | [[use-categories]] |
| `usePlaceSearch` | react-query + mutation | `["place-search", "suggest", q, proximity]` | [[use-place-search]] |
| `useCreateCategory` / `useDeleteCategory` | mutation | invalidates `["categories"]`, `["places"]` | [[use-categories]] |
| `useDebouncedCallback` | utility | — | [[use-debounce]] |
| `useFilters` | local-state + URL sync | — | [[use-filters]] |
| `useLists` + 6 mutations | react-query + mutations | `["lists"]`, `["place-lists", placeId]` | [[use-lists]] |
| `useMapStyle` | localStorage + theme | — | [[use-map-style]] |
| `usePlaces` + 4 mutations | react-query + mutations | `["places", filters]` | [[use-places]] |
| `useSharedLink` + 3 mutations | react-query + mutations | `["shared-link", type, id]` | [[use-shared-links]] |
| `useStats` | react-query (staleTime 5min) | `["stats"]` | [[use-stats]] |
| `useTags` + 4 mutations | react-query + mutations | `["tags"]`, `["place-tags", placeId]` | [[use-tags]] |
| `useTrips` + 9 mutations | react-query + mutations | `["trips"]`, `["trip", id]` | [[use-trips]] |

## Conventions

- **Query keys:** stable arrays, namespaced by entity (`["places", filters]`, `["trip", id]`).
- **`staleTime`:** default 60 s from the QueryClient. Override per-hook only with a reason.
- **Mutations always invalidate at least their own key.** Cross-entity invalidation is documented per hook.
- **Direct Supabase vs API route:** simple list/CRUD use Supabase JS (`useCategories`, `useTags`, `useLists`); compound operations route through `/api/*` (e.g. `usePlaces` because filtering is complex; `useTrips` because Mapbox enrichment happens server-side).
- **Auth check inside hooks:** mutations that create rows call `supabase.auth.getUser()` first — RLS would block anonymous writes anyway, but the explicit check produces a nicer error.

## Patterns to follow

When you add a hook:

1. Filename `use-<thing>.ts`. Export `useThing` and related mutation hooks.
2. Stable query key namespaced under the entity.
3. Use the appropriate data source per the rule above.
4. After mutations, `queryClient.invalidateQueries({ queryKey: [...] })`.
5. Document in `docs/03-frontend/hooks/use-<thing>.md` from the [[../../_meta/templates/hook|hook template]].

See [[../../_agent/common-tasks#add-a-new-custom-hook]] for the full checklist.
