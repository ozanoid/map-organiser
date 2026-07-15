---
title: saved_filters
type: table
domain: backend
version: 1.0.0
last_updated: 15.07.2026
status: stable
sources:
  - src/lib/hooks/use-saved-filters.ts
related:
  - "[[../rls-policies]]"
  - "[[../../03-frontend/hooks/use-filters]]"
  - "[[../../05-flows/ai-search-flow]]"
---

# saved_filters

Saved filter presets / quick chips (v1.20.0, S2 F-03 + NF-20/21).
Created via MCP migration `create_saved_filters_table`.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `user_id` | uuid | no | — | FK → `auth.users.id` ON DELETE CASCADE |
| `name` | text | no | — | Unique per user |
| `query_string` | text | no | — | URL-shape serialization (`filtersToQueryString`) — same format the filter-persist store uses. Applying = `router.push(?qs)` (full replace, back/forward-safe) |
| `ai_query` | text | yes | — | Non-null when saved from an AI search: the NL query. The chip re-runs the AI pipeline via `useAiSearch` — rankings are session-only and never stored |
| `sort_order` | int | no | `0` | Display order (chips row) |
| `created_at` | timestamptz | yes | `now()` | |

## Indexes

- `saved_filters_pkey` — PK
- `saved_filters_user_id_name_key` — UNIQUE `(user_id, name)`
- `idx_saved_filters_user` — btree `(user_id)`, RLS predicate scan

## RLS policies

| Policy | Command | Role | Expression |
|---|---|---|---|
| Users manage own saved filters | ALL | authenticated | `auth.uid() = user_id` (USING + WITH CHECK) |

Default-deny otherwise. No public access.

## Foreign keys

- `user_id` → `auth.users.id` (CASCADE)

## Notes

- CRUD goes through the browser Supabase client directly
  (`use-saved-filters.ts`) — no API route; RLS is the boundary, matching
  the tags/lists pattern.
- Unique-name violations surface as a friendly client error (23505 map).
- **Stale taxonomy IDs (accepted):** `query_string` stores tag/category/
  list/subcategory IDs by value. Deleting one of those entities later
  leaves a chip that filters to an empty grid — honest but unexplained.
  No FK/cleanup; revisit if it confuses users.
