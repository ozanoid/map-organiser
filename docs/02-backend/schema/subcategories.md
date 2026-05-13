---
title: subcategories
type: table
domain: backend
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[categories]]"
  - "[[places]]"
  - "[[../../01-domain/categories-and-tags]]"
tags:
  - core
  - taxonomy
---

# `subcategories`

Per-user, granular classification under each parent category. ~62 default
rows seeded per user on signup; users can add custom rows. AI Phase 4
proposals land here as `is_pending=true` rows awaiting moderation.

Each row references one of the user's parent `categories` rows (same
`user_id`). A `Place` may carry at most one `subcategory_id`.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id` ON DELETE CASCADE. |
| `parent_category_id` | uuid | no | — | FK → `categories.id` ON DELETE CASCADE. |
| `name` | text | no | — | Display name (Title Case for defaults). |
| `slug` | text | no | — | URL/AI-safe identifier (lowercase-hyphenated). |
| `is_default` | boolean | no | `false` | `true` for the ~62 rows seeded by `seed_default_subcategories_for_user()`. |
| `is_pending` | boolean | no | `false` | `true` for AI-proposed subcategories awaiting moderation (Phase 5). Excluded from filter UI. |
| `proposed_at` | timestamptz | yes | — | Set when AI Phase 4 inserts a pending row. |
| `approved_at` | timestamptz | yes | — | Set when `is_pending` flips to `false`. |
| `created_at` | timestamptz | no | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `subcategories_pkey` | `id` | btree UNIQUE | Primary key. |
| `subcategories_user_id_parent_category_id_slug_key` | `(user_id, parent_category_id, slug)` | btree UNIQUE | Prevents duplicate slugs under the same parent for a single user. |
| `idx_subcategories_user` | `user_id` | btree | RLS predicate scan. |
| `idx_subcategories_parent` | `parent_category_id` | btree | Lookup by parent (filter cascade UI). |
| `idx_subcategories_pending` | `user_id WHERE is_pending = true` | btree partial | Moderation queue hot path. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own subcategories | ALL | authenticated | `auth.uid() = user_id` (with_check identical) |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | CASCADE |
| `parent_category_id` | `categories.id` | CASCADE — if a category is deleted, its subcategories go with it. |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `places.subcategory_id` | references `subcategories.id` | **SET NULL** — places fall back to parent-category-only classification. |

## Functions & triggers

| Object | Type | Purpose |
|---|---|---|
| `seed_default_subcategories_for_user(p_user_id uuid)` | function | Idempotently seeds the default dictionary for a given user. Called by the signup trigger and by the one-off backfill. SECURITY DEFINER. EXECUTE revoked from anon/authenticated. |
| `handle_new_profile_subcategories()` | trigger function | Wraps `seed_default_subcategories_for_user(NEW.id)`. SECURITY DEFINER. |
| `z_on_profile_created_default_subcategories` | trigger | AFTER INSERT on `profiles`. The `z_` prefix forces alphabetical ordering AFTER `on_profile_created_default_categories` (PostgreSQL AFTER-trigger ordering rule), so parent categories exist before subcategories are inserted. Verified via `information_schema.triggers.action_order` (1 then 2). |

## Default dictionary

Seeded by `seed_default_subcategories_for_user()`. 62 rows per user.

| Parent | Subcategories |
|---|---|
| Restaurant | fine-dining, casual, brunch, steakhouse, seafood, sushi, pizza, kebab, vegan-restaurant, fast-food |
| Cafe | specialty-coffee, brunch-cafe, dessert-cafe, bakery-cafe, book-cafe |
| Bar & Nightlife | cocktail-bar, wine-bar, pub, beer-garden, nightclub, rooftop-bar, sports-bar, jazz-bar |
| Hotel & Accommodation | boutique-hotel, luxury-hotel, hostel, bed-and-breakfast, resort |
| Shopping | mall, boutique, local-market, department-store, souvenir-shop |
| Museum & Culture | art-museum, history-museum, science-museum, contemporary-art, gallery |
| Park & Nature | urban-park, national-park, botanical-garden, viewpoint, hiking-trail |
| Beach | sandy-beach, rocky-beach, beach-club, secluded-cove |
| Gym & Sports | fitness-center, yoga-studio, climbing-gym, swimming-pool, sports-arena |
| Health & Medical | pharmacy, clinic, hospital, spa, dental |
| Entertainment | cinema, theater, concert-venue, amusement-park, escape-room |
| Other | (none) |

## Notes

- **Migration history**:
  - `create_subcategories_table` (14.05.2026)
  - `add_subcategory_id_to_places` (14.05.2026)
  - `create_seed_default_subcategories_function` (14.05.2026)
  - `create_subcategories_signup_trigger` (14.05.2026)
  - `backfill_subcategories_for_existing_users` (14.05.2026)
- **Why per-user (not global)**: a global default set would create echo-chambers ("everyone proposes the same new subcategory"). Per-user keeps moderation scoped and avoids cross-tenant noise. AI proposals are gated by [[../../05-flows/ai-suggestions-flow|the Phase 5 moderation queue]].
- **Why `z_` prefix on the trigger**: PostgreSQL fires AFTER triggers in alphabetical order; `z_on_profile_created_default_subcategories` sorts after the existing `on_profile_created_default_categories`, so categories exist before subcategories reference them.
- **Consumed by**: every `/api/subcategories/*` route, `/api/places` (GET filter + insert via `subcategory_id`), `useSubcategories` hook, `CategoryFilter` cascade UI, Phase 4 AI place-profile generation, Phase 5 moderation queue UI.

## Open questions

- **Sub-category icon**: currently no icon column. Phase 4's filter cascade renders a plain text pill. If we add icons, mirror the parent's hex color or assign a child-specific palette.
- **Pending-row lifetime**: no TTL on `is_pending = true` rows. If the user never moderates, they linger. Worth a Phase 5 follow-up: auto-purge pending rows older than 30 days.
- **Bulk re-categorize after delete**: when a default sub-category is deleted, places using it fall back to NULL silently. A confirm dialog could warn about the count.
