---
title: System Overview
type: overview
domain: overview
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - AGENTS.md
  - src/middleware.ts
  - src/lib/supabase/middleware.ts
  - src/lib/providers.tsx
  - src/app/manifest.ts
  - src/app/layout.tsx
related:
  - "[[tech-stack]]"
  - "[[repo-structure]]"
  - "[[glossary]]"
  - "[[../01-domain/places]]"
  - "[[../01-domain/trips]]"
  - "[[../01-domain/sharing]]"
  - "[[../02-backend/auth]]"
---

# System Overview

## What it is

**Map Organiser** is a single-user PWA for organizing places saved from Google Maps, planning multi-day trips, and publishing read-only public shares of either. It's currently web-only (Vercel-deployed), with iOS and AI categorization on the roadmap.

The model in one sentence: **users collect Places, group them into Lists, lay them across days as Trips, and optionally share Lists or Trips via slug URLs.** Places carry rich metadata (Google + DataForSEO enrichment) and live on a PostGIS map.

## Audience and use cases

- **Primary user:** the maintainer organizing personal travel.
- **Public viewer:** anyone with a `/shared/<slug>` link (no account needed).
- **Future:** mobile native app, AI-driven categorization.

Typical session:

1. Paste a Google Maps link from mobile share menu (PWA `share_target`) → place is parsed, enriched, saved.
2. Bulk-import a Google Takeout file → batched enrichment + insert.
3. Tag and categorize, set visit status, drop into lists.
4. Build a trip from a list → auto-plan distributes places across days, draws Mapbox routes.
5. Share a list or trip → copy slug URL.

## High-level architecture

```
┌───────────────────────────────── Vercel ──────────────────────────────────┐
│                                                                             │
│   Next.js 16 App Router                                                     │
│   ┌───────────────┬────────────────┬─────────────┬─────────────────────┐   │
│   │  (app)/       │  (auth)/       │  /api/      │  /shared/<slug>     │   │
│   │  authed UI    │  login,signup  │  handlers   │  public read view   │   │
│   └───────┬───────┴────────┬───────┴──────┬──────┴──────────┬──────────┘   │
│           │                │              │                  │              │
│   ┌───────┴────────────────┴──────────────┴──────────────────┴──────────┐   │
│   │  src/middleware.ts → updateSession (Supabase SSR)                    │   │
│   │  • redirects unauthenticated users to /login                         │   │
│   │  • exempts /, /auth/callback, /shared/*, /api/shared/*               │   │
│   └─────────────────────────────────┬────────────────────────────────────┘   │
│                                     │                                        │
│   ┌──────────────┬──────────────────┼───────────────────┬──────────────┐    │
│   ▼              ▼                  ▼                   ▼              ▼    │
│ Supabase     Mapbox GL          Google Places       DataForSEO     Recharts │
│ Postgres   + Directions API     (server-only)       Business Data  (client) │
│ + PostGIS    (NEXT_PUBLIC tok)                                              │
│ + Auth                                                                       │
│ + Storage                                                                    │
│   (place-                                                                    │
│    photos)                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Subsystems

| Subsystem | Lives in | Notes |
|---|---|---|
| Auth | `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `src/app/auth/callback/` | Cookie-SSR via `@supabase/ssr`. Google OAuth. |
| Places | `src/app/api/places/*`, `src/app/(app)/places/`, `src/components/places/` | The core entity. See [[../01-domain/places]]. |
| Trips | `src/app/api/trips/*`, `src/app/(app)/trips/[id]/`, `src/lib/trip/` | Multi-day plans with auto-plan + Mapbox routes. See [[../01-domain/trips]]. |
| Lists | `src/app/api/lists/*`, `src/app/(app)/lists/` | Ordered place groupings. See [[../01-domain/lists]]. |
| Sharing | `src/app/api/shared/*`, `src/app/shared/[slug]/` | Public read links via service-role bypass. See [[../01-domain/sharing]]. |
| Filters & search | `src/components/filters/`, `src/lib/hooks/use-filters.ts` | Country/city, category, tag, list, rating, visit status, sort. |
| Map | `src/components/map/`, `src/lib/map/` | Mapbox GL view with cluster, popups, route polylines, custom markers. |
| Stats | `src/app/api/stats/`, `src/app/(app)/stats/` | Recharts dashboard backed by aggregate queries. |
| Import | `src/app/api/places/import-*`, `src/app/(app)/import/`, `src/lib/stores/import-store.ts` | Client-driven batched import with Zustand progress. |
| Settings | `src/app/(app)/settings/`, `src/components/settings/` | Categories, tags, encrypted API keys, theme. |
| Theme | `src/lib/providers.tsx`, `src/lib/hooks/use-map-style.ts` | next-themes light/dark/system; map style and marker style preferences. |
| PWA | `src/app/manifest.ts`, `public/sw.js`, `src/components/sw-register.tsx`, `src/app/offline/` | `share_target` POST to `/api/share-target`, offline fallback. |
| Observability | `src/lib/google/track-usage.ts` + `public.api_usage` table + `increment_api_usage()` RPC | Per-SKU API counter for cost tracking. |

## Cross-cutting

- **Server state** lives in TanStack Query (`useQueryClient` configured in `src/lib/providers.tsx`, `staleTime: 60s`, `refetchOnWindowFocus: false`). All entity hooks (`usePlaces`, `useTrips`, `useLists`, …) wrap React Query.
- **Client state** that spans pages lives in Zustand (currently only `src/lib/stores/import-store.ts`).
- **Row-Level Security** is the security spine: every user-owned table has `auth.uid() = user_id` policies. The only public read is on `shared_links` (active links only). The service-role client bypasses RLS and is used exclusively for serving public share content.
- **PostGIS geography** stores place coordinates; `src/lib/geo.ts` parses EWKB/WKT/GeoJSON into `{lat, lng}` once for every API route. See [[../01-domain/geo-and-s2]].

## Roadmap fingerprints in code

- **PWA share target** wired and active (mobile-first inbound flow).
- **DataForSEO** is the default enrichment provider; Google path is gated by `profiles.google_places_enabled`.
- **`shared/[slug]/save`** endpoint exists — viral loop is implemented (logged-in viewers can copy into their own account).

## Known sharp edges

- Supabase schema is **dashboard-managed**. Migrations are listed via MCP (28 to date) but there's no local `supabase/migrations/` folder.
- `.env.local.example` is missing `SUPABASE_SERVICE_ROLE_KEY` even though `src/lib/supabase/server.ts#createServiceClient` reads it. See [[../06-ops/env-vars]] when written.
- Several `SECURITY DEFINER` functions are exposed to `anon` per advisor (incl. `handle_new_user`, `create_default_categories`, `increment_api_usage`). Listed in [[../02-backend/rls-policies]] (when written) and `[[../_agent/pitfalls#supabase]]`.
- Tests are not present in the repo.

For deeper reading: [[tech-stack]] for the dependency-by-dependency view, [[repo-structure]] for the folder map, [[glossary]] for terminology.
