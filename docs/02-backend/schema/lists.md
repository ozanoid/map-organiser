---
title: lists
type: table
domain: backend
version: 2.0.0
last_updated: 18.11.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118044126_lists_created_via.sql
  - supabase/migrations/20261118044153_list_functions.sql
related:
  - "[[_README]]"
  - "[[list_places]]"
  - "[[../../01-domain/lists]]"
  - "[[plans]]"
---

# `lists`

Named, ordered collections of places with no date. 8 rows on 18.11.2026 (none on the owner's account yet).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `name` | text | no | — | 1–120 characters (checked by `save_list`). |
| `description` | text | yes | — | What the list is for; ≤ 2,000. |
| `color` | text | yes | `'#059669'` | Hex; presentational. |
| `created_via` | text | no | `'app'` | `app` \| `assistant` (CHECK) — who made it, like `plans` and `visits` (v1.40.0). |
| `created_at` | timestamptz | yes | `now()` | — |
| `updated_at` | timestamptz | yes | `now()` | Set by `save_list` on every save. |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `lists_pkey` | `id` | btree UNIQUE | Primary key. |
| `idx_lists_user` | `user_id` | btree | RLS predicate scan. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own lists | ALL | authenticated | `auth.uid() = user_id` |

## Writes

Creating and changing a list — name, description, colour and its places — is `save_list` ([[list_places#Writes: save_list]]) through `src/lib/lists/write.ts`; deleting is a plain delete scoped by `user_id` (`deleteList`). Nothing else writes the table since v1.40.0.

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | CASCADE |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `list_places` | `list_id` | CASCADE |
| `plans` | `list_id` | SET NULL — the plan survives without the back-link |
| `trips` | `list_id` | (NO ACTION) — the table is no longer used by the app, see [[trips]] |

## Notes

- **Migrations.** `create_lists` (2026-04-09), `lists_created_via` (18.11.2026).
- **List vs Plan.** A list is an ordered bag of places with no time; a plan lays places across one or more days. A list can seed a plan (`plans.list_id`; its places become the stops of day 1), but the plan doesn't reflect back into the list.
- **Shared links** (`shared_links.resource_type = 'list'`) aren't removed when a list is deleted; they answer "List not found".
