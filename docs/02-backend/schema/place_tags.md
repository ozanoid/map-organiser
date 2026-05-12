---
title: place_tags
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[tags]]"
  - "[[../../01-domain/categories-and-tags]]"
---

# `place_tags`

Junction table connecting `places` ↔ `tags`. M:N. Owns nothing extra — no `sort_order`, no `created_at` even.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `place_id` | uuid | no | — | FK → `places.id`. |
| `tag_id` | uuid | no | — | FK → `tags.id`. |

**Primary key:** `(place_id, tag_id)` composite.

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `place_tags_pkey` | `(place_id, tag_id)` | btree UNIQUE | PK + lookup. |

The composite PK is sufficient for the access patterns we use. A separate index on `tag_id` alone would help "find all places with this tag", but the API filter does it post-fetch in JS today.

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own place_tags | ALL | authenticated | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |

Indirect ownership — gated through `places.user_id`. There's no `user_id` column on this junction; the user is derived from the place.

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `place_id` | `places.id` | CASCADE |
| `tag_id` | `tags.id` | CASCADE |

## Notes

- **Bulk insert pattern.** API routes (`/api/places/bulk`, `/api/places/[id]`) use UPSERT-style operations to set the tag list on a place: DELETE all existing rows for the place, INSERT the new set. Not the cheapest but keeps app logic dead simple.
- **No `created_at`.** When a tag was attached isn't tracked. If we ever want "recently tagged" UI, add a column.
- Consumed by: place CRUD routes, bulk operations, the inline tag input.
