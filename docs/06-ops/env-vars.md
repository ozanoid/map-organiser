---
title: Env Vars
type: overview
domain: ops
version: 1.2.0
last_updated: 14.05.2026
status: stable
sources:
  - .env.local.example
  - src/lib/supabase/client.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/middleware.ts
  - src/lib/ai/client.ts
  - src/lib/google/get-user-api-keys.ts
  - src/lib/dataforseo/client.ts
related:
  - "[[_README]]"
  - "[[encryption]]"
  - "[[deployment]]"
  - "[[../04-integrations/supabase]]"
  - "[[../04-integrations/mapbox]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/dataforseo]]"
---

# Env Vars

Every environment variable the app reads, where it lives, and who depends on it.

## Canonical list

| Variable | Public? | Required? | Source | Used by |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ public | yes | Supabase project | Browser + server clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ public | yes | Supabase project | Browser + server clients |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ server-only | yes (for public sharing) | Supabase project → Settings → API | `createServiceClient()` (sole user: `GET /api/shared/[slug]`) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | ✅ public (URL-restricted) | yes | Mapbox account → tokens | MapView + server-side Directions fallback |
| `MAPBOX_SERVER_TOKEN` | ❌ server-only | optional (recommended) | Mapbox account → secret token (no URL restriction) | `src/lib/mapbox/search-box.ts` proxy for Search Box `/suggest` and `/retrieve`. Falls back to public token if absent. |
| `GOOGLE_PLACES_API_KEY` | ❌ server-only | optional (admin fallback) | Google Cloud Console | `getUserApiKeys` if no per-user key |
| `ENCRYPTION_SECRET` | ❌ server-only | yes | Generated; documented in [[encryption]] | `encryptApiKey` / `decryptApiKey` for `profiles.*_enc` |
| `DATAFORSEO_LOGIN` | ❌ server-only | yes | DataForSEO account | Default enrichment provider basic auth |
| `DATAFORSEO_PASSWORD` | ❌ server-only | yes | DataForSEO account | Same |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ❌ server-only | optional (required for AI features) | https://aistudio.google.com/apikey | `src/lib/ai/client.ts#getAiClient` — Gemini Flash for AI-01/AI-03/AI-04/AI-05. When absent, `/api/user/ai-settings` reports `available: false` and the Settings AI toggle is disabled. |

## Where they're set

| Environment | Source |
|---|---|
| Local development | `.env.local` (gitignored) — copy from `.env.local.example`, fill in values |
| Vercel Preview | Vercel dashboard → Environment Variables → Preview |
| Vercel Production | Vercel dashboard → Environment Variables → Production |

`vercel pull` syncs Vercel env vars into a local `.env.local` for matching the deployed environment.

## Known gaps

### `SUPABASE_SERVICE_ROLE_KEY` missing from `.env.local.example`

The example file does NOT list `SUPABASE_SERVICE_ROLE_KEY`, but `src/lib/supabase/server.ts#createServiceClient` reads it. **A fresh clone won't have public sharing working until the dev figures this out.**

Fix:

```diff
 # Supabase
 NEXT_PUBLIC_SUPABASE_URL=
 NEXT_PUBLIC_SUPABASE_ANON_KEY=
+SUPABASE_SERVICE_ROLE_KEY=

 # Mapbox
```

Then bump this doc's version.

### `profiles.dataforseo_login_enc` / `dataforseo_password_enc` exist but unused

The schema has columns for per-user DataForSEO credentials, but no API route exposes them. DataForSEO is env-only today. If we add per-user DataForSEO billing, surface them in `/api/user/api-keys`.

## What "public" means

`NEXT_PUBLIC_` is a Next.js convention: any env var prefixed with it is embedded into the browser bundle. **Anything without that prefix is server-only** and cannot be read from Client Components.

Practical rules:

- **Never** add `NEXT_PUBLIC_` to a secret. Once it's in the bundle, it's public.
- **`NEXT_PUBLIC_MAPBOX_TOKEN`** is intentionally public — Mapbox restricts it by URL on their side.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** is intentionally public — RLS protects the data, the anon key is just a JWT issuer key.

## What lives where

| Env var | Loaded from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `process.env.NEXT_PUBLIC_SUPABASE_URL` in all three Supabase client files |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | `process.env.SUPABASE_SERVICE_ROLE_KEY` in `src/lib/supabase/server.ts#createServiceClient` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `process.env.NEXT_PUBLIC_MAPBOX_TOKEN` in `MapView` and `src/lib/trip/directions.ts` |
| `GOOGLE_PLACES_API_KEY` | `process.env.GOOGLE_PLACES_API_KEY` in `getUserApiKeys` (admin fallback) |
| `ENCRYPTION_SECRET` | `process.env.ENCRYPTION_SECRET` in the AES-256-GCM helpers |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | `process.env.DATAFORSEO_*` in `src/lib/dataforseo/client.ts` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `process.env.GOOGLE_GENERATIVE_AI_API_KEY` in `src/lib/ai/client.ts#getAiClient` |

## When to add a new env var

See [[../_agent/common-tasks#update-env-vars]]. The short checklist:

1. Add to `.env.local.example` with a comment (no value).
2. Add to Vercel Preview + Production.
3. Update this doc.
4. If it's an integration secret, also update the matching `04-integrations/<service>.md`.
5. CHANGELOG.

## Open questions

- **Validation at startup.** No code asserts the presence of required env vars. A bad config silently produces broken auth or crashed routes. Worth a `src/lib/env.ts` that validates with Zod at module load — `if (!url) throw new Error(...)`.
- **Per-environment defaults.** No `.env.development` / `.env.production` defaults committed. Always rely on Vercel / local `.env.local`.
