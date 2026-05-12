---
title: list_places
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[lists]]"
  - "[[places]]"
  - "[[../../01-domain/lists]]"
---

# `list_places`

Junction connecting `lists` ↔ `places` with explicit ordering. 95 rows in snapshot.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `list_id` | uuid | no | — | FK → `lists.id`. |
| `place_id` | uuid | no | — | FK → `places.id`. |
| `sort_order` | int | yes | `0` | Within-list display order. |
| `added_at` | timestamptz | yes | `now()` | When the place was added to this list. |

**Primary key:** `(list_id, place_id)` composite.

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `list_places_pkey` | `(list_id, place_id)` | btree UNIQUE | PK + lookup. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own list_places | ALL | authenticated | `list_id IN (SELECT id FROM lists WHERE user_id = auth.uid())` |

Indirect ownership — derived from `lists.user_id`.

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `list_id` | `lists.id` | CASCADE |
| `place_id` | `places.id` | CASCADE |

## Notes

- **Migration.** Created with `create_lists` (2026-04-09); `add_sort_order_to_list_places` (2026-04-15) added the ordering column.
- **Reorder is bulk-replace.** `PATCH /api/lists/[id]/reorder` accepts an ordered array of place IDs and rewrites every `sort_order` for that list in parallel (`Promise.all` of UPDATEs).
- **Order in `GET /api/places?list=...`.** The places-list endpoint joins through `list_places` and orders by `sort_order` ASC.
- **Append on insert.** When a place is added one at a time, the API uses `sort_order = MAX(sort_order) + 1`. Bulk adds (UPSERT) take whatever the caller passes; defaults to 0.
- Consumed by: list detail view (drag-and-drop reorder), `GET /api/places` filtered by list, bulk-actions "add to list".

## Open questions

- **Reorder transactionality.** The reorder endpoint uses parallel `UPDATE` calls (`Promise.all`). A partial failure could leave the list in a half-reordered state. Worth either a single SQL statement with CASE...WHEN, a stored proc, or explicit transaction.
