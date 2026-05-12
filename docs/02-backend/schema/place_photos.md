---
title: place_photos
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
  - "[[../../01-domain/places]]"
tags:
  - storage
---

# `place_photos`

Photo metadata for places. Each row references a file in the `place-photos` Storage bucket. **0 rows in snapshot** — the table is wired but currently dormant. The canonical place photo path today is `places.google_data.photo_storage_url` (a Storage URL), not this table.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `place_id` | uuid | no | — | FK → `places.id`. |
| `storage_path` | text | no | — | Path inside the `place-photos` bucket. |
| `caption` | text | yes | — | Free-form. |
| `created_at` | timestamptz | yes | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `place_photos_pkey` | `id` | btree UNIQUE | Primary key. |
| `idx_place_photos_place` | `place_id` | btree | Find photos for a place. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own place_photos | ALL | authenticated | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `place_id` | `places.id` | CASCADE |

## Storage bucket

`place-photos`:

- **Public** read (anyone with the URL can fetch).
- 5 MB size limit.
- MIME allow-list: `image/jpeg`, `image/png`, `image/webp`.
- Path convention: first folder must equal `auth.uid()` (enforced by Storage RLS).

Storage RLS policies (on `storage.objects`):

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users can upload place photos | INSERT | authenticated | `bucket_id = 'place-photos' AND foldername(name)[1] = auth.uid()::text` |
| Users can view own place photos | SELECT | authenticated | same |
| Users can update own place photos | UPDATE | public | same |
| Users can delete own place photos | DELETE | authenticated | same |

> The bucket is publicly readable via CDN URL regardless of these policies — the SELECT policy controls Storage-API reads, not direct URL fetches.

## Notes

- **Migrations.** `create_place_photos` (2026-04-09), `create_storage_bucket` (2026-04-09), `add_storage_update_policy_for_place_photos` (2026-04-14).
- **Why 0 rows.** The current ingest path stores the primary photo URL directly inside `places.google_data.photo_storage_url`. `place_photos` would be relevant for multi-photo collections per place, but that's not wired up.
- **Migrate-photos route writes Storage, not `place_photos`.** `POST /api/places/migrate-photos` downloads `google_data.photos[0]`, uploads to `place-photos` Storage, and writes the public URL back into `google_data.photo_storage_url`. No `place_photos` row gets created.

## Open questions

- **Is the table dead code?** If multi-photo support never materializes, the table can be dropped (along with its policies and the `place-photos` bucket policy chain) to reduce surface area. If it's intended for future user-uploaded photos, document that intent here.
