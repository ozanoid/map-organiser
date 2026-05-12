---
title: Supabase
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/supabase/
  - package.json
related:
  - "[[../02-backend/_README]]"
  - "[[../02-backend/supabase-clients]]"
  - "[[../02-backend/auth]]"
  - "[[../02-backend/schema/_README]]"
  - "[[../02-backend/rls-policies]]"
---

# Supabase

Postgres + Auth + Storage + (optionally) Vault, Edge Functions, Realtime — all from one provider. The backend spine of the app.

## Account & access

- **Provider:** Supabase
- **Project ID:** `hukppmaevcapvbrvxtph`
- **Region:** `eu-central-1`
- **Plan:** Pro
- **Org:** `ozanoid` (slug `jkgdrpvhtfpkundmzsvl`)
- **URL:** `https://hukppmaevcapvbrvxtph.supabase.co`
- **Auth method (server):** anon key + service-role key
- **Auth method (browser):** anon key + cookie session via `@supabase/ssr`

## NPM packages

| Package | Version | Role |
|---|---|---|
| `@supabase/ssr` | `^0.10.3` | Cookie-based SSR auth helpers (`createBrowserClient`, `createServerClient`) |
| `@supabase/supabase-js` | `^2.103.0` | Underlying client used by `createServiceClient` (service-role) |

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | All three clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Browser + server (cookie-scoped) clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `createServiceClient()` for `/api/shared/[slug]` GET |

> **Gap:** `.env.local.example` is missing `SUPABASE_SERVICE_ROLE_KEY`. See [[../06-ops/env-vars]].

## What we use

| Surface | This repo's usage |
|---|---|
| **Postgres** | The whole schema. 13 user tables + PostGIS internal. See [[../02-backend/schema/_README]]. |
| **Row-Level Security** | Every user-owned table has `auth.uid() = user_id` policies. Public read carve-out on `shared_links`. See [[../02-backend/rls-policies]]. |
| **PostGIS** | `places.location geography(Point, 4326)` + GIST index. |
| **Auth** | Google OAuth + email/password. Cookie session via `@supabase/ssr`. See [[../02-backend/auth]]. |
| **Storage** | `place-photos` bucket (public, 5 MB, jpeg/png/webp). |
| **Migrations** | 28 to date, managed via Supabase dashboard / MCP `apply_migration`. No local `supabase/migrations/` folder. |
| **Realtime** | Not used. |
| **Edge Functions** | None deployed. See [[../02-backend/edge-functions]]. |
| **Vault** | Extension installed, no current usage. |
| **MCP** | Used by the dev agent (Claude Code) to inspect tables, policies, run SQL, list migrations. See `.claude/settings.local.json`. |

## Three clients

See [[../02-backend/supabase-clients]] for the canonical breakdown. In one line:

- **Browser** — `src/lib/supabase/client.ts` (Client Components).
- **Server** — `src/lib/supabase/server.ts` (Server Components, route handlers).
- **Service-role** — `src/lib/supabase/server.ts#createServiceClient` (only `/api/shared/[slug]` GET).
- **Middleware** — `src/lib/supabase/middleware.ts` (refreshes session on every request).

## Failure modes

- **Connection lost:** Supabase JS throws; React Query exposes `error` and retries 3× with backoff. UI should surface a toast.
- **RLS denies the query:** returns empty result set, no error. The bug usually traces to the wrong client choice (browser vs server) or a misconfigured cookie. See [[../_agent/pitfalls#supabase-supabase-ssr]].
- **Service-role key compromised:** rotate immediately in dashboard → Settings → API. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel + local `.env.local`.
- **Storage quota:** unknown current usage. Pro plan ships 100 GB; the `place-photos` bucket grows with imports.

## Cost & limits (Pro plan baseline)

- Database: 8 GB included
- Storage: 100 GB included
- Edge Functions: 2 M invocations / month
- Auth: unlimited MAUs (paid features in Pro)
- Realtime: 500 concurrent + 5 M messages / month

Current usage is well within free tier limits — see Supabase dashboard for live numbers.

## Replacement strategy

If we had to leave Supabase:

- **Postgres** → any Postgres provider (Neon, RDS, self-hosted). RLS would need re-implementation.
- **Auth** → NextAuth / Auth.js or a homegrown JWT layer.
- **Storage** → S3 / Vercel Blob.

Code paths that would change: everything in `src/lib/supabase/`, every RLS-aware API route (most of them).

The biggest portability concern is **RLS** — most providers don't expose row-level policies the same way. A reimplementation would push that logic into the API layer.
