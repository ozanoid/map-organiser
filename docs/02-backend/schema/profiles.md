---
title: profiles
type: table
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
tags:
  - users
  - encryption
---

# `profiles`

Per-user profile and settings. 1:1 with `auth.users` (the `id` is both PK and FK). Holds display name, encrypted API keys, and feature flags.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | — | **PK** and **FK** → `auth.users.id`. |
| `full_name` | text | yes | — | Populated by `handle_new_user()` from `raw_user_meta_data.full_name` / `name`. |
| `avatar_url` | text | yes | — | Populated by `handle_new_user()` from `raw_user_meta_data.avatar_url`. |
| `is_admin` | boolean | no | `false` | Reserved. Not currently checked anywhere. |
| `google_api_key_enc` | text | yes | — | AES-256-GCM encrypted Google Places API key. Server-only. |
| `mapbox_token_enc` | text | yes | — | Encrypted personal Mapbox token. |
| `dataforseo_login_enc` | text | yes | — | Encrypted DataForSEO username. |
| `dataforseo_password_enc` | text | yes | — | Encrypted DataForSEO password. |
| `google_places_enabled` | boolean | yes | `true` | Per-user toggle for Google enrichment path. |
| `created_at` | timestamptz | yes | `now()` | — |
| `updated_at` | timestamptz | yes | `now()` | App-managed (no DB trigger). |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `profiles_pkey` | `id` | btree UNIQUE | Primary key. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users can view own profile | SELECT | authenticated | `auth.uid() = id` |
| Users can update own profile | UPDATE | authenticated | `auth.uid() = id` |
| Users can insert own profile | INSERT | authenticated | (with_check) `auth.uid() = id` |

Note: no DELETE policy is defined — profiles can only be deleted by cascading from `auth.users` deletion or by the service-role client.

## Foreign keys

### Outgoing

| Column | References | On delete | On update |
|---|---|---|---|
| `id` | `auth.users.id` | (default: NO ACTION; effectively cascades via `auth.users` deletion) | — |

### Incoming

None directly. Other tables reference `auth.users.id`, not `profiles.id`.

## Triggers / functions

| Trigger | Event | Function |
|---|---|---|
| `on_profile_created_default_categories` | AFTER INSERT | `create_default_categories()` — seeds the 12 default categories for the new user. |

Profile rows themselves are created by `handle_new_user()`, which fires on `auth.users` INSERT.

## Notes

- **Migration ownership.** Schema managed via Supabase migrations (see [[_README#migrations]]):
  - `create_profiles` (2026-04-09)
  - `enable_pgcrypto` (2026-04-13)
  - `add_api_keys_to_profiles` (2026-04-13)
  - `add_dataforseo_credential_columns` (2026-04-14)
  - `add_google_places_enabled_to_profiles` (2026-04-15)
- **Encryption.** All `*_enc` columns use AES-256-GCM with `ENCRYPTION_SECRET` server-only env var. Helpers in `src/lib/google/get-user-api-keys.ts` and `src/components/settings/api-keys-manager.tsx` flow. See [[../../06-ops/encryption]] when written.
- **Why FK to `auth.users` and not Supabase Auth API.** The 1:1 with FK lets RLS predicates use `auth.uid() = id` directly without subqueries.
- **Why no `email` column.** Email lives in `auth.users.email` (Supabase Auth's responsibility). Reading it requires the service-role client.
- Consumed by: every authenticated route via `getUserApiKeys()`, the API key manager UI, the cost tracker, the parse-link enrichment provider selector.

## Open questions

- **Encryption key rotation.** No documented rotation procedure for `ENCRYPTION_SECRET`. Rotating it would render every `*_enc` column unreadable until re-encrypted with the new key. Worth a runbook.
- **`is_admin` removal.** If admin features stay out of scope, drop the column to reduce surface area.
