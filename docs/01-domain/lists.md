---
title: List
type: entity
domain: lists
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/lists/schema.ts
  - src/lib/lists/read.ts
  - src/lib/lists/write.ts
  - src/lib/hooks/use-lists.ts
  - src/app/api/lists/route.ts
  - src/app/api/lists/[id]/route.ts
  - src/app/(app)/lists/page.tsx
  - src/app/(app)/lists/[id]/page.tsx
  - src/components/lists/
  - src/lib/assistant/tools/get-lists.ts
  - src/lib/assistant/tools/save-list.ts
  - supabase/migrations/20261118044125_list_items_order_and_access.sql
  - supabase/migrations/20261118044126_lists_created_via.sql
  - supabase/migrations/20261118044153_list_functions.sql
related:
  - "[[places]]"
  - "[[plans]]"
  - "[[sharing]]"
  - "[[../02-backend/schema/lists]]"
  - "[[../02-backend/schema/list_places]]"
  - "[[../02-backend/api-routes/lists]]"
  - "[[../04-integrations/claude-mcp]]"
---

# List

A named, ordered collection of saved places with no date — a "Tokyo coffee tour", a wishlist, or a shortlist Claude builds: "solo dinners to try in November". Each place on a list can carry a **note for that list** — why it is there, what to order. A list can also seed a [[plans|Plan]] (its places become the stops of day 1).

*List ≠ plan:* a list has no time and no outcome; a plan is tied to dates, people and what happened ([[../_plans/phase-1-planning]]).

## Shape

### `lists`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | — |
| `user_id` | uuid | FK → `auth.users`, RLS-scoped. |
| `name` | text | 1–120 characters (checked by `save_list`). |
| `description` | text \| null | What the list is for; ≤ 2,000. |
| `color` | text | Hex, default `#059669`. Presentational only. |
| `created_via` | `app` \| `assistant` | Who made it (v1.40.0). Existing lists are `app`. |
| `created_at`, `updated_at` | timestamptz | `save_list` touches `updated_at` on every save. |

### `list_places`

| Field | Type | Notes |
|---|---|---|
| `list_id`, `place_id` | uuid | Primary key `(list_id, place_id)`: a place is on a list at most once. |
| `sort_order` | int, not null | The order: **0..n-1, dense** (v1.40.0). |
| `note` | text \| null | The place's note on this list; ≤ 2,000. |
| `added_at` | timestamptz | — |

Types: `PlaceList` (a list, with `place_count` in lists), `ListDetail` (a list with its `items`), `ListItem` (place id, position, note, added; optionally a light `place`), `PlaceListMembership` (a list as a place sees it: the list, the note, the position) — `src/lib/types/index.ts`.

## Rules

- **One write path.** Every change to `lists` / `list_places` is one call to the Postgres function `save_list` through `src/lib/lists/write.ts` — the list pages, the place page, new places, bulk actions, imports, saving a shared list, the in-app assistant and Claude. One call is one transaction: a batch lands completely or not at all. (Before v1.40.0 eight code paths wrote the tables directly, including the browser.)
- **Order is dense.** Adding inserts at a position (default: the end) and shifts the rest; removing closes the gap; a move shifts what is between. Rows left with ties or gaps by older writes are put in shape before a save's changes run. (Until v1.40.0 every add wrote 0 — three lists had all of their 12–47 places at 0 and the order shown was undefined; the migration numbered them by old order, then by when they were added.)
- **Only the user's own places.** `save_list` checks every place, and the RLS policy's `WITH CHECK` requires the place to be the user's too (v1.40.0; before, a client could put another user's place id on its own list).
- **Adding a place that is already on the list** keeps its position; a note given replaces its note. Removing a place that isn't on it is reported, not an error. A reorder must name every place once.
- **The place page touches one list at a time.** Ticking or unticking a list changes that list only; on the place's other lists it keeps its position and its note. (The old route deleted all of a place's list rows and inserted them again, which put it first on every list.) Taking a place off a list can be undone — back in its place, with its note.
- **Notes are per list.** The same place can say "order the lamb" on one list and "for a rainy day" on another; the place's own note (on the place page) is separate.
- **Deleting a list** removes it and its notes for good; its places stay saved, a plan seeded from it keeps going (`plans.list_id` → null). Only from the app — Claude doesn't delete lists.
- **Limits:** 1,000 places a list, 1,000 changes a call, 2,000 characters a note or description.

## Where it shows

- `/lists` — the Lists tab: every list with its place count; "New List".
- `/lists/[id]` — the list: places in order (drag to reorder), each with its note; a place's menu edits the note or takes it off the list (Undo, 8 s); the list menu copies a share link, renames, edits the description, deletes (confirmation dialog). List or map view, kept in the URL (`?view=map`).
- `/places/[id]` — the Lists section: the place's lists as badges, ticked in a picker, and each list's note under them.
- `/shared/[slug]` — a shared list shows each place's list note (Ozan's decision, 18.11.2026); saving it copies the list, its order and the notes ([[sharing]]).
- **Claude** (v1.40.0): `get_lists` reads lists (one in full with its places and notes), `save_list` creates or changes one, `get_places` shows a place's lists with its note there — [[../04-integrations/claude-mcp]].

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `lists.user_id` |
| [[places\|Place]] | M:N | `list_places` with `sort_order` and `note`; a deleted place leaves its lists (cascade) |
| [[plans\|Plan]] | 1:N optional | `plans.list_id` (ON DELETE SET NULL) |
| [[sharing\|Shared link]] | 0..N | `shared_links.resource_type = 'list'` |

## Code

- **Module** `src/lib/lists/`: `schema.ts` (`listChangesSchema`, `listOpSchema`, `listSetSchema`, `listCreateSchema` — strict zod, shared with Claude's tools), `read.ts` (`listLists`, `getList`, `listsOfPlaces`), `write.ts` (`createList`, `changeList`, `deleteList`, `addPlacesToList`, `addPlaceToLists`, `setPlaceLists`; `ListInputError` → 400, `ListNotFoundError` → 404).
- **Routes** [[../02-backend/api-routes/lists]]: `GET`/`POST /api/lists`, `GET`/`PATCH`/`DELETE /api/lists/[id]`.
- **Hooks** [[../03-frontend/hooks/use-lists]]: `useLists`, `useList`, `useCreateList`, `useDeleteList`, `useChangeList`, `useTogglePlaceOnList`.
- **Components** `src/components/lists/`: `ListMenu`, `ListNoteDialog`, `useListEditor`; `src/components/places/inline-list-creator.tsx`.
