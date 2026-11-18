---
title: useLists
type: hook
domain: frontend
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/hooks/use-lists.ts
  - src/lib/lists/local.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/lists]]"
  - "[[../../02-backend/api-routes/lists]]"
---

# `useLists` and family

Lists as server state, all through `/api/lists` (v1.40.0 — before, the hook wrote `lists` / `list_places` from the browser).

## Query keys

| Key | What |
|---|---|
| `["lists"]` | Every list with its place count (`useLists`). |
| `["lists", id]` | One list: its items in order — place id, position, note (`useList`). |
| `["places", { list_id }]` | The list's places themselves (`usePlaces`), for the cards and the map. |

One list sits under the overview's key, so invalidating `["lists"]` — what writes elsewhere do (a new place with lists, a bulk add, the in-app assistant, a deleted place) — also refreshes an open list page.

## Exports

```ts
function useLists(): UseQueryResult<PlaceList[]>
function useList(id: string | undefined): UseQueryResult<ListDetail | null>   // null: not the user's / deleted
function useCreateList(): UseMutationResult<{ id: string }, Error, { name; description?; color? }>
function useDeleteList(): UseMutationResult<void, Error, string>
function useChangeList(listId: string): UseMutationResult<{ list: ListDetail | null }, Error, ListChanges>
function useTogglePlaceOnList(): UseMutationResult<void, Error, { listId; placeId; on; note?; position? }>
```

- **`useChangeList`** — `PATCH /api/lists/[id]` with `{ set, ops }`. The change shows at once: before the request goes out the cached list takes it (`applyListChanges`, `src/lib/lists/local.ts` — order, notes, removals, name and description, by `save_list`'s rules; a place that is added appears with the answer). Writes to one list share a key and a scope and run one after another; the server's answer replaces the cached list only for the last write still queued — an earlier answer would undo, on screen, the writes behind it. After an error, or a committed write whose list couldn't be read back, the list is read again. The places are read again only when a write adds or removes places.
- **`useTogglePlaceOnList`** — the place page's list picker: one list, one `add_place` / `remove_place`; `note` and `position` put a place back as it was (Undo). Toggles queue in one scope.
- **`useDeleteList`** — sets `["lists", id]` to `null` so a page or a Back to the URL shows "not found", not the deleted list from the cache. The dialog that deletes navigates with `mutateAsync`: the delete unmounts it, and `mutate()`'s per-call callbacks don't run after that ([[../../_agent/pitfalls]]).

Components: `useListEditor` (`src/components/lists/use-list-editor.ts`) wraps `useChangeList` with the toast for a refused change, like `usePlanEditor` for plans.
