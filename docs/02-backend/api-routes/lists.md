---
title: Lists routes
type: route-group
domain: backend
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/lists/route.ts
  - src/app/api/lists/[id]/route.ts
  - src/lib/lists/schema.ts
  - src/lib/lists/read.ts
  - src/lib/lists/write.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/lists]]"
  - "[[../schema/lists]]"
  - "[[../schema/list_places]]"
  - "[[../../03-frontend/hooks/use-lists]]"
---

# Lists routes

Every list write in the app goes through these routes (v1.40.0) — one call to the module `src/lib/lists`, one call to the Postgres function `save_list`, one transaction. Until then the browser wrote `lists` / `list_places` directly and only reordering had a route (`PATCH /api/lists/[id]/reorder`, removed: a reorder is now an op).

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/lists` | The user's lists with place counts, newest first (`listLists`). |
| `POST` | `/api/lists` | New list `{ name, description?, color? }` → 201 `{ id }` (`createList`, `created_via = app`). |
| `GET` | `/api/lists/[id]` | The list with its items in order — `place_id`, `sort_order`, `note`, `added_at` (`getList`). The places themselves come from `/api/places?list=…`. 404 when it isn't the user's. |
| `PATCH` | `/api/lists/[id]` | `{ set?, ops? }` → the list as it is afterwards plus `added` / `already` / `removed` / `absent` (place ids). |
| `DELETE` | `/api/lists/[id]` | Removes the list and its notes; its places stay. |

## `PATCH /api/lists/[id]`

The body is `listChangesSchema` (`src/lib/lists/schema.ts`) — the same definition Claude's `save_list` takes, so its `.describe()` texts are written for the model too. Every object is strict: an unknown key is a 400.

```jsonc
{
  "set": { "name": "Solo dinners — November", "description": null },
  "ops": [
    { "op": "add_place", "place_id": "…", "note": "order the lamb", "position": 0 },
    { "op": "remove_place", "place_id": "…" },
    { "op": "set_note", "place_id": "…", "note": null },
    { "op": "move_place", "place_id": "…", "position": 2 },
    { "op": "reorder", "place_ids": ["…", "…"] }
  ]
}
```

- Ops apply in order after `set`; the batch lands completely or not at all.
- `add_place` on a place already on the list keeps its position; only a note with words in it replaces its note. Clearing a note is `set_note` with `null`.
- `remove_place` of a place that isn't on the list is reported in `absent`, not an error. `reorder` must name every place once.
- Only the user's own places can go on a list; another user's place refuses the whole call.
- Responses: 200 `{ list, added, already, removed, absent }` (`list: null` if the list couldn't be read back — the change is committed, the client refetches); 400 with the database's sentence ("place … is not on this list", "a list holds up to 1000 places"); 404 when the list isn't the user's.

## Errors

`ListInputError` → 400 and `ListNotFoundError` → 404 through `errorResponse` (`src/lib/api/http.ts`); anything else is logged and answered 500 "Something went wrong — nothing was changed".

## Other routes that put places on lists

They call the same module, not the tables: `POST /api/places` with `list_ids` (`addPlaceToLists`, at the end of each list; a list that is gone is skipped and logged), `PATCH /api/places/[id]` with `list_ids` (`setPlaceLists` — only the lists that change are written), `POST /api/places/bulk` `add_to_list` (`addPlacesToList`, one transaction; `affected` counts the places newly added), `POST /api/shared/[slug]/save` for a list (`createList` with its places and notes), the import drain (`addPlaceToLists`), the in-app assistant's `add_to_list` / `create_list` ([[ai]]).
