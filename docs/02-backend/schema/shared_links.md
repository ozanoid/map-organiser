---
title: shared_links
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[../../01-domain/sharing]]"
  - "[[../rls-policies#the-shared-links-carve-out]]"
  - "[[../supabase-clients#serverts-createserviceclient---bypass-rls]]"
---

# `shared_links`

Public, slug-addressed pointers to a user's list or trip. The **only** user-data table in the schema with a public-read RLS policy. 3 rows in snapshot.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. The creator/owner. |
| `resource_type` | text | no | — | CHECK: `'list'` or `'trip'`. |
| `resource_id` | uuid | no | — | Points at `lists.id` or `trips.id`. **Not FK-constrained** (polymorphic). |
| `slug` | text | no | — | **UNIQUE**. Generated via `nanoid(10)`. The path segment in `/shared/<slug>`. |
| `is_active` | boolean | yes | `true` | Toggle to 404 the link without deleting the row. |
| `view_count` | int | yes | `0` | Incremented on each public read. Best-effort (no transaction lock). |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `shared_links_pkey` | `id` | btree UNIQUE | Primary key. |
| `shared_links_slug_key` | `slug` | btree UNIQUE | Slug uniqueness. |
| `idx_shared_links_slug` | `slug WHERE is_active = true` | btree partial | Hot path — `/shared/<slug>` resolution. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Anyone can read active shared links | SELECT | **public** | `is_active = true` |
| Users can manage own shared links | ALL | public | `auth.uid() = user_id` |

The first policy is the carve-out. Anonymous (anon) requests can SELECT rows where `is_active = true`. The owner can still ALL (insert/update/delete).

**This does NOT grant access to the underlying list/trip data.** Those still need either `auth.uid() = user_id` or service-role bypass. See [[../rls-policies#the-shared-links-carve-out]].

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |

### Incoming

None.

## Notes

- **Migration.** `create_shared_links_table` (2026-04-15).
- **Polymorphic `resource_id` is intentional.** No FK constraint — the app verifies on create that the user owns the referenced list/trip. If the underlying resource is deleted, the share link survives but `/shared/<slug>` will 404 (since the service-role read fails to find the joined row).
- **POST is idempotent.** `POST /api/shared` returns the existing share link for the same `(user_id, resource_type, resource_id)` if one exists; doesn't create duplicates.
- **`view_count` is racy.** Concurrent reads can lose updates. Acceptable for a vanity counter; switch to a stored proc or `pgmq` job if it becomes load-bearing.
- **Disable is preferred over delete.** UI exposes `PATCH is_active = false`, not DELETE — reversible.
- Consumed by: `/api/shared/*` routes, `/shared/[slug]/page.tsx`.

## Open questions

- **Stale resource_id.** When a referenced list/trip is deleted, the share link becomes a 404 silently. Worth either (a) DELETing matching `shared_links` rows on parent deletion via a trigger, or (b) auto-disabling them.
- **No expiry.** Links live forever once enabled. Consider an optional `expires_at` for "temporary share" use cases.
