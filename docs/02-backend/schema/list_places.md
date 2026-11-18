---
title: list_places
type: table
domain: backend
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118005404_list_place_notes.sql
  - supabase/migrations/20261118044125_list_items_order_and_access.sql
  - supabase/migrations/20261118044153_list_functions.sql
  - supabase/migrations/20261118051158_list_note_rules.sql
related:
  - "[[_README]]"
  - "[[lists]]"
  - "[[places]]"
  - "[[../../01-domain/lists]]"
---

# `list_places`

The places on a list, in order, each with its note for that list. 108 rows on 18.11.2026 (6 lists with items).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `list_id` | uuid | no | — | FK → `lists.id`. |
| `place_id` | uuid | no | — | FK → `places.id`. |
| `sort_order` | int | **no** | `0` | Position in the list, **0..n-1 with no ties or gaps** — kept so by `save_list` (v1.40.0; was nullable, and every add wrote 0). |
| `added_at` | timestamptz | yes | `now()` | When the place was put on the list. |
| `note` | text | yes | — | Why the place is on this list / what to order (≤ 2,000; trimmed). Written by `save_list`, shown on the list page, the place page, the shared list and to Claude. |

**Primary key:** `(list_id, place_id)` — a place is on a list at most once.

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `list_places_pkey` | `(list_id, place_id)` | btree UNIQUE | PK + "the places of a list". |
| `list_places_place_id_idx` | `(place_id)` | btree | "The lists of a place" — place page, Claude's `get_places`, place deletes (v1.40.0). |

## RLS policies

| Policy | CMD | Role | USING | WITH CHECK |
|---|---|---|---|---|
| Users manage own list_places | ALL | public | the list is the user's | the list **and the place** are the user's (v1.40.0) |

Before v1.40.0 the check looked at the list only, so a client could put another user's place id on its own list. No such row existed when it was tightened.

## Writes: `save_list`

Every write goes through `save_list(p_user_id, p_list)` (`SECURITY INVOKER`; `…044153_list_functions.sql`, revised in `…051158_list_note_rules.sql`) — via `src/lib/lists/write.ts`. One call is one transaction:

```
p_list = { list_id?, created_via?, set?: { name?, description?, color? }, ops?: [...] }
ops:  add_place    { place_id, note?, position? }   on the list already → keeps its position;
                                                    only a non-blank note replaces its note
      remove_place { place_id }                      not on it → reported in `absent`
      set_note     { place_id, note }                null or blank clears it
      move_place   { place_id, position }
      reorder      { place_ids }                     every place of the list, once
→ { list_id, created, added, already, removed, absent }
```

- Without `list_id` it creates the list (`set.name` required, `created_via` `app` | `assistant`).
- Rows older writes left with ties or gaps are renumbered before the ops run; positions are clamped (0..n for an add, 0..n-1 for a move).
- Checks: the caller acts for themselves (`plan_assert_caller`), the list is theirs (`P0002` otherwise), every added place is theirs, ≤ 1,000 places a list and ≤ 1,000 ops a call, notes and descriptions ≤ 2,000, names 1–120 — all trimmed of spaces, tabs and line breaks. Refusals use `22023` and a sentence the caller can show.
- The list row is locked for the transaction, so two saves to one list run one after the other.
- `EXECUTE` is revoked from `public` and `anon`.

## Foreign keys

| Column | References | On delete |
|---|---|---|
| `list_id` | `lists.id` | CASCADE |
| `place_id` | `places.id` | CASCADE — a deleted place leaves a gap in the order, closed by the list's next save |

## Notes

- **Migrations.** `create_lists` (2026-04-09), `add_sort_order_to_list_places` (2026-04-15), `list_place_notes` (18.11.2026), `list_items_order_and_access` (18.11.2026: the existing order was numbered 0..n-1 by old order, then by `added_at` — three lists had all of their 12–47 places at 0), `list_functions`, `list_note_rules`.
- **Read by:** `src/lib/lists/read.ts` (`getList`, `listsOfPlaces`), `GET /api/places?list=…` (order by `sort_order`), the public share view, Claude's `get_lists` / `get_places`.
