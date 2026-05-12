---
title: tags
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[place_tags]]"
  - "[[../../01-domain/categories-and-tags]]"
---

# `tags`

Free-form labels attached to places. Per-user. M:N with places via `place_tags`. No defaults — every user starts with an empty set.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `name` | text | no | — | Unique per user. |
| `color` | text | yes | — | Optional hex color. |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `tags_pkey` | `id` | btree UNIQUE | Primary key. |
| `tags_user_id_name_key` | `(user_id, name)` | btree UNIQUE | Enforces unique name per user. |
| `idx_tags_user` | `user_id` | btree | RLS predicate scan. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own tags | ALL | authenticated | `auth.uid() = user_id` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |

### Incoming

| Source | Column | On delete |
|---|---|---|
| `place_tags` | `tag_id` | CASCADE |

## Notes

- **Migrations.** `create_tags` (2026-04-09), `add_color_to_tags` (2026-04-10).
- **Tags vs categories.** Categories are 1:1 with places and drive map markers. Tags are M:N and presentational. See [[../../01-domain/categories-and-tags#categories-vs-tags--when-to-pick-which]].
- **Inline creation.** `src/components/places/inline-tag-input.tsx` lets users create tags on the fly from a place card — no separate "create tag" UI is required.
- Consumed by: `place_tags`, the tag filter UI, the bulk-actions "add tags" operation.

## Open questions

- **No tag-merge UX.** If a user creates "cafe" and later "cafés", there's no way to merge them. Worth a settings action if tag counts grow.
