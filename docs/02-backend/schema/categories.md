---
title: categories
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[../../01-domain/categories-and-tags]]"
  - "[[places]]"
  - "[[profiles]]"
---

# `categories`

Per-user classification of places. 12 default categories are seeded on signup; users can add, rename, recolor, and delete (no protection on defaults). 36 rows in snapshot (12 defaults × 3 users).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `name` | text | no | — | Unique per user. |
| `color` | text | no | `'#059669'` | Hex color. |
| `icon` | text | no | `'map-pin'` | Lucide icon name. |
| `sort_order` | int | no | `0` | Display order in Settings + filter pills. |
| `is_default` | boolean | no | `false` | `true` for the 12 seeded by `create_default_categories()`. |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `categories_pkey` | `id` | btree UNIQUE | Primary key. |
| `categories_user_id_name_key` | `(user_id, name)` | btree UNIQUE | Enforces unique name per user. |
| `idx_categories_user` | `user_id` | btree | RLS predicate scan. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own categories | ALL | authenticated | `auth.uid() = user_id` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `places` | `category_id` | (NO ACTION — orphaning the place's category nullably) |

## Triggers / functions

The 12 defaults come from `create_default_categories()`, fired by `on_profile_created_default_categories` AFTER INSERT on `profiles`. The 12 are (canonical, from the function body):

| `sort_order` | `name` | `color` | `icon` |
|---|---|---|---|
| 0 | Restaurant | `#EF4444` | `utensils` |
| 1 | Cafe | `#F97316` | `coffee` |
| 2 | Bar & Nightlife | `#8B5CF6` | `wine` |
| 3 | Hotel & Accommodation | `#3B82F6` | `bed-double` |
| 4 | Shopping | `#EC4899` | `shopping-bag` |
| 5 | Museum & Culture | `#6366F1` | `landmark` |
| 6 | Park & Nature | `#22C55E` | `trees` |
| 7 | Beach | `#06B6D4` | `umbrella` |
| 8 | Gym & Sports | `#F59E0B` | `dumbbell` |
| 9 | Health & Medical | `#14B8A6` | `heart-pulse` |
| 10 | Entertainment | `#A855F7` | `ticket` |
| 11 | Other | `#6B7280` | `map-pin` |

## Notes

- **Migrations.** `create_categories` (2026-04-09), `add_is_default_to_categories` (2026-04-10), `create_default_categories_trigger` (2026-04-10), `seed_default_categories_existing_users` (2026-04-10).
- **Why per-user.** Categories aren't shared — each user has their own set. Even the 12 defaults are duplicated per user (so they can be edited independently).
- **Why no protection on defaults.** The `is_default` flag is a marker, not a lock. Users can delete or rename their defaults; nothing rebuilds them.
- **Icon coupling to canvas renderer.** `src/lib/map/category-icons.ts` ships sprites only for the 12 default icon names. User-added categories with custom icons fall back to `map-pin`. See [[../../01-domain/categories-and-tags#open-questions]].
- Consumed by: `places.category_id`, every place list/detail UI, map marker rendering, auto-plan day-internal ordering, stats `byCategory` aggregate.

## Open questions

- **Reset-to-defaults flow.** No way to restore the original 12 if a user deletes them. Worth a runbook + `POST /api/categories/reset-defaults` if defaults matter.
