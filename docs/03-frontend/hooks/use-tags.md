---
title: useTags
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-tags.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/categories-and-tags]]"
  - "[[../../02-backend/schema/tags]]"
  - "[[../../02-backend/schema/place_tags]]"
---

# `useTags` and family

Five exports — the list, two mutations, a place-scoped sub-query, and a toggle.

## Signatures

```ts
function useTags(): UseQueryResult<Tag[], Error>
function useCreateTag(): UseMutationResult<Tag, Error, string>  // name
function useDeleteTag(): UseMutationResult<void, Error, string>  // id
function usePlaceTags(placeId: string | undefined): UseQueryResult<Tag[], Error>
function useTogglePlaceTag(): UseMutationResult<
  Place,
  Error,
  { placeId: string; tagId: string; currentTagIds: string[] }
>
```

## Behavior

| Hook | Source | Invalidates |
|---|---|---|
| `useTags` | Supabase `select * from tags order by name asc`. | `["tags"]` |
| `useCreateTag` | Supabase insert. | `["tags"]` |
| `useDeleteTag` | Supabase delete by id. | `["tags"]`, `["places"]` |
| `usePlaceTags(placeId)` | `GET /api/places/[id]` then extract `tags[]`. Enabled when `placeId` is defined. | — |
| `useTogglePlaceTag` | `PATCH /api/places/[id]` with the toggled `tag_ids` array. Toggle logic: include if missing, exclude if present. | `["place-tags", placeId]`, `["places"]` |

## Query keys

- `["tags"]` — user's tags.
- `["place-tags", placeId]` — tags for a specific place.

## Consumers

- `src/app/(app)/settings/page.tsx` (Tags tab) — `useTags`, `useCreateTag`, `useDeleteTag`.
- `src/app/(app)/import/page.tsx` — `useTags` (for the "add tags during import" option).
- `src/components/filters/tag-filter.tsx` — `useTags`.
- `src/components/places/bulk-action-bar.tsx` — `useTogglePlaceTag`.
- `src/components/places/inline-tag-input.tsx` — `useTogglePlaceTag`.

## Edge cases

- **`useTogglePlaceTag` reads `currentTagIds` from the caller.** The hook doesn't fetch the current set itself — the caller passes it in. If the caller's data is stale, the toggle could fail to actually toggle. Worth a refactor to read from the cache directly.
- **Delete cascade to places.** `useDeleteTag` invalidates `["places"]` because places carry joined tag data; the cards would otherwise still show the dead tag until refetch.
- **No optimistic updates** on toggle — UI re-renders after the round-trip.
