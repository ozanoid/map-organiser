---
title: useLists
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-lists.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/lists]]"
  - "[[../../02-backend/api-routes/lists]]"
---

# `useLists` and family

Seven exports — one query for the list of lists, plus mutations and a place-scoped sub-query.

## Signatures

```ts
function useLists(): UseQueryResult<PlaceList[], Error>
function useCreateList(): UseMutationResult<PlaceList, Error, { name: string; description?: string; color?: string }>
function useDeleteList(): UseMutationResult<void, Error, string>
function useAddToList(): UseMutationResult<void, Error, { listId: string; placeId: string }>
function useRemoveFromList(): UseMutationResult<void, Error, { listId: string; placeId: string }>
function useReorderListPlaces(): UseMutationResult<void, Error, { listId: string; placeIds: string[] }>
function usePlaceLists(placeId: string | undefined): UseQueryResult<PlaceList[], Error>
```

## Behavior

| Hook | Source | Invalidates |
|---|---|---|
| `useLists` | Supabase `select *, list_places(count)` ordered by `created_at desc`. `place_count` mapped from the count aggregate. | `["lists"]` |
| `useCreateList` | Supabase insert. | `["lists"]` |
| `useDeleteList` | Supabase delete by id. | `["lists"]` |
| `useAddToList` | Supabase insert into `list_places`. | `["lists"]`, `["places"]` |
| `useRemoveFromList` | Supabase delete from `list_places`. | `["lists"]`, `["places"]` |
| `useReorderListPlaces` | `PATCH /api/lists/[id]/reorder` (because it's a bulk update). | `["places"]` |
| `usePlaceLists(placeId)` | `GET /api/places/[id]` and extract `lists[]`. Enabled only when `placeId` is defined. | — (read-only) |

## Query keys

- `["lists"]` — the user's lists.
- `["place-lists", placeId]` — the lists a given place belongs to (read via `/api/places/[id]`).

## Consumers

- `src/app/(app)/lists/page.tsx` — `useLists`.
- `src/app/(app)/lists/[id]/page.tsx` — `useLists`, `useAddToList`, `useRemoveFromList`, `useReorderListPlaces`, `usePlaceLists`.
- `src/app/(app)/places/[id]/page.tsx` — `usePlaceLists`.
- `src/app/(app)/import/page.tsx` — `useCreateList` (for the "add to new list" option during bulk import).
- `src/components/filters/list-filter.tsx` — `useLists`.
- `src/components/places/add-place-dialog.tsx` — `useLists`, `useAddToList`.
- `src/components/places/bulk-action-bar.tsx` — `useAddToList`, `useRemoveFromList`.
- `src/components/places/inline-list-creator.tsx` — `useCreateList`.

## Edge cases

- **`useReorderListPlaces` invalidates only `["places"]`** — not `["lists"]`. That's correct because list metadata didn't change, only the order of joined places. The places query (which orders by `list_places.sort_order` when filtered by list) needs to refetch.
- **Optimistic updates** are not currently used. Drag-and-drop reorder in the list detail page uses local state for the visual feedback, then fires the mutation; React Query refetches and the list re-renders.
- **`usePlaceLists` is a thin projection.** It hits `/api/places/[id]` (full place detail) just to read the `lists[]` array. Worth a dedicated lightweight endpoint if this becomes hot.
