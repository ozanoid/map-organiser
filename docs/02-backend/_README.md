---
title: Backend Overview
type: overview
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/supabase/client.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/middleware.ts
  - src/middleware.ts
  - src/app/api/
related:
  - "[[supabase-clients]]"
  - "[[auth]]"
  - "[[rls-policies]]"
  - "[[edge-functions]]"
  - "[[schema/_README]]"
  - "[[api-routes/_README]]"
  - "[[../00-overview/system-overview]]"
---

# Backend Overview

The "backend" in this repo is a thin layer: Next.js API route handlers + Supabase (Postgres + Auth + Storage). There is no separate server process. Everything runs on Vercel as Vercel Functions (Fluid Compute), and the bulk of the business rules live in **Row-Level Security policies** rather than imperative code.

## Layers

```
   Client (browser / Server Component)
        │
        ▼
   src/middleware.ts   ← runs first; refreshes Supabase session, gates auth
        │
        ▼
   Next.js route handler   (src/app/api/.../route.ts)
        │
        ├──► createClient()         (cookie-scoped Supabase, respects RLS)
        ├──► createServiceClient()  (service-role, bypasses RLS — public share path only)
        └──► fetch(...)             (Google Places, DataForSEO, Mapbox Directions, Supabase Storage)
        │
        ▼
   Supabase Postgres + Auth + Storage
   • RLS on every public table (incl. shared_links, with a public-read carve-out)
   • PostGIS geography for places.location
   • 2 trigger functions seed profile + default categories on signup
   • 1 RPC (increment_api_usage) for per-SKU usage counters
```

## Surfaces

| Surface | Doc |
|---|---|
| Supabase clients (browser/server/middleware/service) | [[supabase-clients]] |
| Auth flow (cookie-SSR, OAuth callback, middleware gates) | [[auth]] |
| Database schema (13 user-facing tables + PostGIS internal) | [[schema/_README]] |
| RLS policies (cross-table view, advisor findings) | [[rls-policies]] |
| Edge functions | [[edge-functions]] |
| API route handlers | [[api-routes/_README]] |

## What's NOT here

- **No separate backend service.** No Express, no FastAPI, no NestJS. All server code is colocated in `src/app/api/.../route.ts`.
- **No ORM.** All queries go through `@supabase/supabase-js` directly.
- **No Prisma migration folder.** Schema is owned by Supabase. Migration history is fetched live via Supabase MCP (`list_migrations` — currently 28 entries).
- **No edge functions.** `supabase functions list` returns empty. If we add one, document in [[edge-functions]].
- **No background workers.** "Background" tasks (review enrichment, photo migration) are simply HTTP requests the client fires-and-forgets after a foreground action — they run inside Vercel Functions, not separate workers.

## Cross-cutting backend conventions

These apply to **every** API route. Enforced informally — see [[../_agent/conventions#api-routes]].

1. **Auth check at the top.** `const { data: { user } } = await supabase.auth.getUser(); if (!user) return ...401`. Exceptions: `/api/shared/[slug]` (public) and `/api/share-target` (PWA inbound — see its doc for the gate).
2. **Zod every body.** Validate before touching the DB. Return `400` with the Zod error on failure.
3. **`Response.json(data, { status })`.** Never bare `Response.json(data)` for non-200s.
4. **RLS does the access control, not the route.** The user-scoped client is enough — `WHERE user_id = auth.uid()` is implicit on every query. Don't add `eq("user_id", user.id)` explicitly — it's redundant and gets out of sync with RLS.
5. **Service-role client only for `/api/shared/[slug]` GET** — the public read path. Never expose it elsewhere.
6. **Server-only env vars never reach the client.** `GOOGLE_PLACES_API_KEY`, `ENCRYPTION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `DATAFORSEO_*` — all no-`NEXT_PUBLIC_` prefix.
7. **Cost-tracked external calls go through `increment_api_usage`** RPC so they show up in `api_usage` and the user's cost tracker.

## Database snapshot (as of `last_updated`)

| Tables | Rows |
|---|---|
| `places` | 458 |
| `list_places` | 95 |
| `trip_day_places` | 102 |
| `categories` | 36 (12 defaults × 3 users) |
| `trip_days` | 33 |
| `api_usage` | 25 |
| `lists` | 6 |
| `trips` | 5 |
| `tags` | 4 |
| `shared_links` | 3 |
| `profiles` | 3 |
| `place_tags` | 2 |
| `place_photos` | 0 |

Schemas, indexes, RLS policies, and full column lists are in [[schema/_README]] and per-table docs.

## Migrations

Supabase manages the schema. Migrations are recorded in the project itself (not the local repo) and can be listed via Supabase MCP `list_migrations`. As of `last_updated`, there are **28 migrations** spanning 2026-04-09 to 2026-04-15. See [[schema/_README#migrations]] for the full list.
