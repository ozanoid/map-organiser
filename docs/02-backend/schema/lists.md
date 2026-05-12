---
title: lists
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[list_places]]"
  - "[[../../01-domain/lists]]"
  - "[[trips]]"
---

# `lists`

Named, ordered groupings of places. 6 rows in snapshot.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `name` | text | no | — | — |
| `description` | text | yes | — | Free-form. |
| `color` | text | yes | `'#059669'` | Hex; default emerald. |
| `created_at` | timestamptz | yes | `now()` | — |
| `updated_at` | timestamptz | yes | `now()` | App-managed. |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `lists_pkey` | `id` | btree UNIQUE | Primary key. |
| `idx_lists_user` | `user_id` | btree | RLS predicate scan. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own lists | ALL | authenticated | `auth.uid() = user_id` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `list_places` | `list_id` | CASCADE |
| `trips` | `list_id` | (NO ACTION — trip becomes orphaned but survives) |

## Notes

- **Migration.** `create_lists` (2026-04-09). `add_sort_order_to_list_places` (2026-04-15) added the ordering column on the junction.
- **List vs Trip.** A list is an ordered bag of places; a trip lays a list (or arbitrary place set) across multi-day calendars. A list can seed a trip (`trips.list_id`), but trips don't reflect back into the list once created.
- **Color is presentational.** Used in filter pills and as marker color when a single-list filter is active.
- Consumed by: list CRUD (via Supabase JS, no dedicated `/api/lists` route except reorder), `list_places`, `trips.list_id`, the import flow's "add to lists" option, the bulk-actions "add to list" operation, public sharing (`shared_links.resource_type = 'list'`).

## Open questions

- **Bulk delete.** No dedicated bulk-list-delete API; UI calls Supabase JS per list. Fine at current scale.
