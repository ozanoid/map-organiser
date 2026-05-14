---
title: Schema
type: overview
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (via MCP)
related:
  - "[[../_README]]"
  - "[[../rls-policies]]"
  - "[[../supabase-clients]]"
---

# Schema

All user-facing tables in the `public` schema of the Supabase project `hukppmaevcapvbrvxtph`. The schema is **managed by Supabase**, not by a local migrations folder, but migration history is recorded server-side and listed via Supabase MCP.

## Tables

| Table | Doc | Rows (snapshot) | Purpose |
|---|---|---|---|
| `profiles` | [[profiles]] | 3 | Per-user profile, encrypted API keys, feature flags |
| `places` | [[places]] | 458 | The core entity — saved Google Maps locations |
| `categories` | [[categories]] | 36 | Classification (12 defaults seeded × 3 users) |
| `subcategories` | [[subcategories]] | 186 | Granular taxonomy under each parent category (~62 defaults × 3 users) |
| `tags` | [[tags]] | 4 | Free-form labels |
| `place_tags` | [[place_tags]] | 2 | Junction: places ↔ tags |
| `lists` | [[lists]] | 6 | Named groupings of places |
| `list_places` | [[list_places]] | 95 | Junction: lists ↔ places with `sort_order` |
| `place_photos` | [[place_photos]] | 0 | Place photo metadata (storage refs) |
| `api_usage` | [[api_usage]] | 25 | Per-SKU API call counters |
| `trips` | [[trips]] | 5 | Multi-day trip plans |
| `trip_days` | [[trip_days]] | 33 | Days within a trip |
| `trip_day_places` | [[trip_day_places]] | 102 | Places within a trip day, ordered |
| `shared_links` | [[shared_links]] | 3 | Public slug links to lists/trips |
| `ai_suggestions_queue` | [[ai_suggestions_queue]] | 0 | Moderation queue for AI-proposed tags & sub-categories (Phase 4 writer, Phase 5 reader) |

> `public.spatial_ref_sys` exists but it's a PostGIS internal table (8500 rows of SRID reference data). Not documented separately.

## Extensions installed

| Extension | Version | Schema | Why |
|---|---|---|---|
| `postgis` | 3.3.7 | `public` | Geography support for `places.location`. Advisor recommends moving out of `public`. |
| `pgcrypto` | 1.3 | `extensions` | Cryptographic primitives for API key encryption helpers. |
| `uuid-ossp` | 1.1 | `extensions` | UUID generation (`gen_random_uuid()` default for many PKs). |
| `supabase_vault` | 0.3.1 | `vault` | Supabase Vault — secret storage (available; usage unclear). |
| `pg_stat_statements` | 1.11 | `extensions` | Query statistics (Supabase default). |
| `plpgsql` | 1.0 | `pg_catalog` | Default Postgres procedural language. |

## Functions & triggers

| Object | Type | Purpose |
|---|---|---|
| `handle_new_user()` | trigger function | On `auth.users` INSERT, creates the matching `public.profiles` row. SECURITY DEFINER. |
| `create_default_categories()` | trigger function | On `public.profiles` INSERT, seeds the 12 default categories. SECURITY DEFINER. |
| `increment_api_usage(p_user_id, p_sku, p_cost)` | RPC | Atomic UPSERT into `api_usage` for cost tracking. SECURITY DEFINER. |

Triggers:

| Trigger | Table | Event | Function |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` |
| `on_profile_created_default_categories` | `public.profiles` | AFTER INSERT | `create_default_categories()` |

## Storage buckets

| Bucket | Public | Size limit | MIME types |
|---|---|---|---|
| `place-photos` | ✅ public read | 5 MB | `image/jpeg`, `image/png`, `image/webp` |

Storage policies enforce that the first folder in the object name matches `auth.uid()`. See [[place_photos]] and [[../rls-policies#storage-storageobjects]].

## Migrations

The schema has been built up through 28 migrations on Supabase. Use Supabase MCP `list_migrations` to fetch the live list. As of `last_updated`:

| # | Version | Name |
|---|---|---|
| 1 | 20260409225919 | enable_postgis |
| 2 | 20260409225930 | create_profiles |
| 3 | 20260409225938 | create_categories |
| 4 | 20260409225948 | create_places |
| 5 | 20260409225958 | create_tags |
| 6 | 20260409230008 | create_lists |
| 7 | 20260409230016 | create_place_photos |
| 8 | 20260409230025 | create_storage_bucket |
| 9 | 20260409230053 | fix_security_search_path |
| 10 | 20260410010546 | add_visit_status |
| 11 | 20260410010548 | add_is_default_to_categories |
| 12 | 20260410010551 | add_color_to_tags |
| 13 | 20260410010605 | create_default_categories_trigger |
| 14 | 20260410010618 | seed_default_categories_existing_users |
| 15 | 20260413001737 | enable_pgcrypto |
| 16 | 20260413001747 | add_api_keys_to_profiles |
| 17 | 20260413001801 | create_api_usage_table |
| 18 | 20260414193540 | add_dataforseo_credential_columns |
| 19 | 20260414204503 | add_storage_update_policy_for_place_photos |
| 20 | 20260414212815 | create_place_categories_junction |
| 21 | 20260414215337 | drop_place_categories_junction |
| 22 | 20260415014456 | add_google_places_enabled_to_profiles |
| 23 | 20260415174557 | add_sort_order_to_list_places |
| 24 | 20260415180431 | create_trips_table |
| 25 | 20260415180440 | create_trip_days_table |
| 26 | 20260415180450 | create_trip_day_places_table |
| 27 | 20260415202047 | create_shared_links_table |
| 28 | 20260415230552 | add_cascade_delete_trip_day_places_place_id |

Adding a new migration: use Supabase MCP `apply_migration` (preferred) or the dashboard SQL editor. Then update this list and the affected per-table doc.

## How this doc relates to per-table docs

This page is the index. Each per-table doc is the canonical reference for:

- Columns + types + nullability + defaults
- All indexes
- All RLS policies attached to that table
- Foreign keys (incoming and outgoing)
- Any triggers/functions tied to it
- Consumers (which API routes / hooks)

If columns, indexes, or policies change, update the per-table doc AND bump this index's `version` if the table list changes.
