---
title: User & Profile
type: entity
domain: users
version: 1.2.0
last_updated: 15.07.2026
status: stable
sources:
  - src/lib/supabase/client.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/middleware.ts
  - src/middleware.ts
  - src/app/auth/callback/route.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/signup/page.tsx
  - src/app/api/user/api-keys/route.ts
  - src/app/api/user/usage/route.ts
  - src/components/settings/api-keys-manager.tsx
  - src/components/settings/cost-tracker.tsx
  - src/lib/google/get-user-api-keys.ts
  - src/lib/google/track-usage.ts
related:
  - "[[categories-and-tags]]"
  - "[[../02-backend/auth]]"
  - "[[../02-backend/schema/profiles]]"
  - "[[../02-backend/schema/api_usage]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/dataforseo]]"
  - "[[../06-ops/encryption]]"
---

# User & Profile

A user is an `auth.users` row managed by Supabase Auth. A **Profile** is the per-user `public.profiles` row created automatically on signup. Together they hold identity, display name, encrypted API keys, and feature flags.

Auth credentials, password hashes, and OAuth identities all live in `auth.*` (managed by Supabase). The repo never touches that schema directly — it goes through `@supabase/ssr`.

## Shape

### `public.profiles`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | **PK + FK** → `auth.users.id`. Matches the auth user 1:1. |
| `full_name` | text | no | Pulled from `raw_user_meta_data.full_name`/`name` on signup. |
| `avatar_url` | text | no | Pulled from `raw_user_meta_data.avatar_url`. |
| `is_admin` | boolean | yes | Default `false`. Not currently checked anywhere in the repo. Reserved. |
| `google_api_key_enc` | text | no | AES-256-GCM-encrypted Google Places API key. Never returned to client. |
| `mapbox_token_enc` | text | no | Encrypted personal Mapbox token (if user opts to use their own). |
| `dataforseo_login_enc` | text | no | Encrypted DataForSEO username. |
| `dataforseo_password_enc` | text | no | Encrypted DataForSEO password. |
| `google_places_enabled` | boolean | no | Default `true`. Toggle to use Google enrichment (if key present) vs DataForSEO-only. |
| `ai_features_enabled` | boolean | yes | Default `true` (Phase 1). Master kill switch for every AI feature. When `false`: lite_profile not built in `parse-link`, `step=profile` skipped from background chain, Settings AI tab hides moderation queue, every `/api/ai/*` and `/api/user/ai-*` route short-circuits. Surfaced as the toggle in Settings → AI. |
| `cron_refresh_enabled` | boolean | no | Default `false` (15.07.2026). Opt-in for the entire periodic-refresh sweep. When `false` the user's places are never scanned by the cron; when `true`, daily Google-data refresh + (if `ai_features_enabled`) AI summary regen past >15 new reviews. Surfaced as "Background data refresh" in Settings → AI. See [[../06-ops/runbooks/periodic-refresh]]. |
| `created_at` | timestamptz | no | `default now()`. |
| `updated_at` | timestamptz | no | `default now()`. |

### Auth provider data

What's in `auth.users` (Supabase-managed; never queried directly):

- `id`, `email`, `email_confirmed_at`
- `raw_user_meta_data` — Google OAuth claims (`full_name`, `avatar_url`, `picture`, …)
- `raw_app_meta_data` — provider info
- Hashed password (if email/password) or external identity reference (if OAuth)

The repo gets the current user via `supabase.auth.getUser()` (server-side) or via the client's session.

## Invariants

- **1:1 with auth.** Every `auth.users` row triggers a `profiles` row via the `on_auth_user_created` trigger. The reverse is enforced by the FK + `id` being the same UUID.
- **Encrypted columns are write-only via API.** `*_enc` columns are never returned to the client. The API key manager flow is "set / clear / show last 4" — never "fetch back the raw value".
- **`google_places_enabled` is a soft toggle.** Even when `true`, enrichment still falls back to DataForSEO if no Google API key is configured for the user.
- **Default categories are seeded once.** The `on_profile_created_default_categories` trigger fires on profile INSERT and creates 12 default rows. Re-running it would duplicate them, so it relies on never firing twice (no reset path exists today).

## Signup → first-use flow

```
  Auth event                          DB cascade
  ────────────                        ──────────
  1. User signs in with Google OAuth
     (or email/password)
     │
     ▼
  2. INSERT auth.users (Supabase Auth)
     │
     │  on_auth_user_created (AFTER INSERT)
     ▼
  3. handle_new_user() runs
     INSERT public.profiles {
       id: new.id,
       full_name: raw_user_meta_data.full_name,
       avatar_url: raw_user_meta_data.avatar_url
     }
     │
     │  on_profile_created_default_categories (AFTER INSERT)
     ▼
  4. create_default_categories() runs
     INSERT 12 default category rows for the new profile
     (Restaurant, Cafe, …, Other)
     │
     ▼
  5. Cookie-SSR session is established
     User is redirected to /map by middleware
```

Both trigger functions are `SECURITY DEFINER` so they can write across schemas (`auth.users` → `public.profiles`).

> **Advisor note:** both `handle_new_user()` and `create_default_categories()` are flagged because they're callable via PostgREST RPC by anonymous/authenticated roles. Since they're trigger functions and don't take meaningful input, the practical risk is low — calling them outside a trigger context fails (they reference `NEW`). Still worth `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` as a hardening pass. See [[../_agent/pitfalls#supabase]].

## Auth flow at runtime

See [[../02-backend/auth]] (when written) for the deeper version. Summary:

1. **Browser** uses `createBrowserClient` (`src/lib/supabase/client.ts`) — reads session from cookies.
2. **Middleware** (`src/middleware.ts` → `src/lib/supabase/middleware.ts#updateSession`) runs on every request: refreshes session cookies, redirects unauthenticated users to `/login`, redirects logged-in users away from `/login` and `/signup`.
3. **Server Components & API routes** use `createClient` (`src/lib/supabase/server.ts`) — reads cookies via `next/headers`.
4. **Service-role client** (`createServiceClient`) bypasses RLS and is used exclusively for public shared-link reads.
5. **OAuth callback** at `src/app/auth/callback/route.ts` — exchanges the OAuth code for a session.

Public routes (middleware exempt): `/`, `/auth/callback/*`, `/shared/*`, `/api/shared/*`. Everything else requires auth.

## API key management

Three external API keys can be set per user:

- **Google Places API key** (`google_api_key_enc`)
- **Mapbox token** (`mapbox_token_enc`) — optional override of the public app token
- **DataForSEO credentials** (`dataforseo_login_enc` + `dataforseo_password_enc`)

Flow:

1. User opens **Settings → API** tab.
2. `ApiKeysManager` (`src/components/settings/api-keys-manager.tsx`) shows masked previews.
3. `POST /api/user/api-keys` with the plaintext value → server encrypts via `ENCRYPTION_SECRET` → stores `*_enc` column.
4. To use: server-side code calls `src/lib/google/get-user-api-keys.ts` which decrypts on demand.

The encryption layer is documented in [[../06-ops/encryption]] (when written).

## API usage tracking

`public.api_usage` records per-SKU API call counts so users can see cost.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | — |
| `user_id` | uuid | FK → `auth.users.id` |
| `sku` | text | Identifier like `google.text_search`, `dataforseo.business_info`. |
| `count` | int | Default 1. Incremented via the `increment_api_usage` RPC. |
| `cost_per_1k` | numeric | Provider's quoted price per 1000 calls. |
| `created_at` | date | `default CURRENT_DATE` (day granularity). |

**Unique constraint:** `(user_id, sku, created_at)` — one row per user/sku/day.

The `increment_api_usage(p_user_id, p_sku, p_cost)` SECURITY DEFINER function does an UPSERT: if today's row exists, `count += 1`; otherwise insert with `count = 1`.

`CostTracker` (`src/components/settings/cost-tracker.tsx`) aggregates the rows for display in Settings → API.

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| `auth.users` | 1:1 | `profiles.id` = `auth.users.id` |
| [[places\|Place]] | 1:N | `places.user_id` |
| [[categories-and-tags\|Category]] | 1:N | `categories.user_id` (12 defaults seeded on signup) |
| [[categories-and-tags\|Tag]] | 1:N | `tags.user_id` |
| [[lists\|List]] | 1:N | `lists.user_id` |
| [[trips\|Trip]] | 1:N | `trips.user_id` |
| [[sharing\|Shared Link]] | 1:N | `shared_links.user_id` |
| Place Photo (via Place) | indirect | `place_photos.place_id` → `places.user_id` |
| `api_usage` | 1:N | `api_usage.user_id` |

## RLS posture

| Table | Policy | Roles | Predicate |
|---|---|---|---|
| `profiles` | view own | authenticated | `auth.uid() = id` |
| `profiles` | update own | authenticated | `auth.uid() = id` |
| `profiles` | insert own | authenticated | `auth.uid() = id` (with_check) |
| `api_usage` | ALL own | authenticated | `auth.uid() = user_id` |

Profile rows are SELECT-only for their owner and the service role. There's no "list users" path for any role.

## Open questions

- **`is_admin` is unused.** Reserved but no code checks it. Likely a future hook for admin tools.
- **Account deletion.** No documented self-serve delete path. Cascading would require RLS-friendly cleanup of places/lists/trips. Worth a runbook.
- **Multi-account scenarios.** The model is strictly per-user. Shared workspaces / teams would require schema changes.
