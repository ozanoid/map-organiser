---
title: Repo Structure
type: overview
domain: overview
version: 1.7.0
last_updated: 16.07.2026
status: stable
sources:
  - src/
  - public/
  - docs/
  - .claude/
  - .github/
  - components.json
  - next.config.ts
  - tsconfig.json
  - postcss.config.mjs
  - eslint.config.mjs
related:
  - "[[system-overview]]"
  - "[[tech-stack]]"
  - "[[../_agent/conventions]]"
---

# Repo Structure

What every top-level directory contains, why it exists, and where to dig further.

## Top level

```
.
├── AGENTS.md                  Pointer warning that Next.js 16 differs from training data
├── CLAUDE.md                  Currently just `@AGENTS.md`. See [[../_agent/claude-md-source]]
├── README.md                  Next.js boilerplate (vestigial — actual project README is docs/README.md)
├── components.json            shadcn config — style `base-nova`, alias map, icon lib
├── eslint.config.mjs          Extends eslint-config-next core-web-vitals + typescript
├── next.config.ts             Empty (no overrides)
├── package.json               Deps + scripts (dev/build/start/lint)
├── package-lock.json          npm lockfile (committed)
├── postcss.config.mjs         Wires @tailwindcss/postcss
├── tsconfig.json              Strict TS; alias `@/*` → `src/*`
├── .env.local.example         Env var keys (no values)
├── .gitignore
├── .claude/                   Claude Code per-repo config (permissions, MCP)
├── .github/                   Workflows (dependabot only)
├── docs/                      This vault
├── public/                    Static assets (PWA icons, service worker)
└── src/                       Application source
```

## `src/` — application source

```
src/
├── middleware.ts              Next.js middleware — calls updateSession from supabase/middleware.ts
├── app/                       App Router routes
│   ├── layout.tsx             Root layout (HTML, providers, fonts)
│   ├── page.tsx               Root index page
│   ├── globals.css            Tailwind v4 @theme tokens + dark variants
│   ├── manifest.ts            PWA manifest (share_target wired here)
│   ├── (app)/                 Auth-required pages (route group)
│   │   ├── layout.tsx         Authenticated shell (header/sidebar/nav)
│   │   ├── map/page.tsx       Mapbox view
│   │   ├── places/page.tsx
│   │   ├── places/[id]/page.tsx
│   │   ├── places/compare/page.tsx  S2 F-04 yan-yana karşılaştırma (v1.19.0)
│   │   ├── lists/page.tsx     Lists + Trips tabs
│   │   ├── lists/[id]/page.tsx
│   │   ├── trips/[id]/page.tsx Timeline + map
│   │   ├── stats/page.tsx     Recharts dashboard
│   │   ├── import/page.tsx    Batch import + Zustand progress
│   │   └── settings/page.tsx  Categories (with sub-cat manage) / Tags / API & Usage / AI / Theme tabs
│   ├── (auth)/                Public auth pages (route group)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── auth/callback/route.ts OAuth callback handler
│   ├── shared/[slug]/page.tsx Public share view (no auth)
│   ├── shared/layout.tsx
│   ├── offline/page.tsx       PWA offline fallback
│   └── api/                   Route handlers (see [[../02-backend/api-routes/_README]])
│       ├── places/            CRUD + bulk + enrich (info/reviews/profile) + refresh-google-data (merge + profile chain) + import + parse-link (returns lite_profile) + migrate-photos
│       ├── ai/                parse-query + rank-results (Phase 6) + compare (v1.19.0) + chat (v1.21.0, streaming) + trip-plan (v1.22.0, writes trip tables)
│       ├── cron/              refresh-places — daily periodic-refresh sweep (CRON_SECRET, service-role, opt-in per user)
│       ├── trips/             CRUD + auto-plan + day PATCH (routing_profile/notes, v1.22.0) + day reorder + day places (move/update shapes) + swap-days
│       ├── lists/[id]/reorder
│       ├── subcategories/     CRUD (per-user; default seed via signup trigger)
│       ├── shared/            Create + public-read + save-to-account
│       ├── stats/             Aggregated stats
│       ├── user/              api-keys + usage + ai-settings + ai-suggestions (list/accept/reject)
│       └── share-target/      PWA share_target sink
├── components/
│   ├── assistant/             AssistantLauncher (header ✨, ai-settings gate) + AssistantPanel (useChat Sheet, v1.21.0)
│   ├── filters/               Category / country-city / list / tag / visit-status / open-now / search filter UIs;
│   │                          save-filter-button + saved-filter-chips (v1.20.0)
│   ├── layout/                AppHeader, AppSidebar, MobileNav, OfflineBanner
│   ├── map/                   MapView, MapContent
│   ├── places/                PlaceCard, AddPlaceDialog (with AI Suggestions panel + sub-cat strip), BulkActionBar, inline creators, VisitStatusToggle, AiSummaryCard,
│   │                          + detail-page widgets (v1.17.0): RatingDistributionBar, PopularTimesWidget, PlaceStatusBadges, PlaceActionLinks, AmenitiesGrid, PlaceTopics, ReviewsSection
│   ├── settings/              ApiKeysManager, CostTracker, AiSettings (master toggle), AiSuggestionsQueue (moderation UI)
│   ├── sw-register.tsx        Service worker registration (client component)
│   └── ui/                    shadcn primitives (avatar, badge, button, card, command, dialog, dropdown-menu, input, input-group, popover, select, separator, sheet, skeleton, sonner, tabs, textarea)
└── lib/
    ├── ai/                    AI SDK v6 wiring (Gemini 3 Flash). client.ts, context-builder.ts,
    │                          dedup.ts, normalize.ts, track-usage.ts (budgets), generate-profile.ts,
    │                          chat-tools.ts (assistant tool belt, v1.21.0; +rank_places v1.23.0); rank-engine.ts (server-side LLM-as-judge twin, v1.23.0);
    │                          schemas/ (Zod — +compare.ts v1.19.0, +trip-plan.ts v1.22.0); prompts/ (place-profile-full.ts, compare.ts, chat.ts,
    │                          trip-plan.ts v1.22.0); extract/ (lite-profile.ts,
    │                          category-resolver.ts, features-extractor.ts,
    │                          suggestions-from-profile.ts); apply-suggestions.ts.
    ├── places/                refresh-google-data.ts — service-client-safe full re-lookup + review merge (shared by refresh route + cron);
    │                          open-now.ts (tz-aware render-time isOpenNow, v1.18.0; +day-granular isOpenOnDate for the AI trip planner, v1.22.0);
    │                          attribute-icons.ts (NF-04 group/icon map);
    │                          query-places.ts + user-stats.ts (v1.21.0 — extracted route engines shared with chat tools)
    ├── dataforseo/            DataForSEO client + types + adapters + transform (mergeReviews) + reviews + photo
    ├── google/                Google Places + URL parser + category mapping + Takeout parser + usage tracker + key access
    ├── hooks/                 React Query hooks (16 files): useAiSearch, useAiSuggestions, useBackfillProfiles, useCategories, useDebounce, useFilters, useLists, useMapStyle, usePlaceSearch, usePlaces, useSavedFilters, useSharedLinks, useStats, useSubcategories, useTags, useTrips
    ├── stores/                Zustand stores (currently just import-store.ts)
    ├── map/                   category-icons.ts (canvas marker rendering)
    ├── trip/                  auto-plan.ts (k-means clustering), directions.ts (Mapbox wrapper, RoutingProfile param v1.22.0),
    │                          cost-defaults.ts (price_level → per-person USD defaults, v1.22.0)
    ├── supabase/              client.ts (browser), server.ts (+ createServiceClient), middleware.ts (updateSession)
    ├── telemetry/             logger.ts (dual-write log.*), trace-context.ts (W3C traceparent mint),
    │                          langfuse.ts (LangfuseSpanProcessor singleton + flushLangfuse) — see [[../05-flows/observability-flow]]
    ├── types/                 index.ts — domain types (Place, Trip, Category, Subcategory, Tag, …)
    ├── geo.ts                 Shared PostGIS point parser (EWKB hex / WKT / GeoJSON / plain object)
    ├── providers.tsx          ThemeProvider + QueryClientProvider
    └── utils.ts               cn() Tailwind class merger
```

> The `src/lib/ai/` tree was added across PRs #30–#35 (AI Phases 1–5.5). The structure is documented in detail under [[../04-integrations/gemini]] and consumed by `src/app/api/places/[id]/enrich/route.ts` (step=profile) and the AI suggestion UI.

## `public/` — static assets

```
public/
├── sw.js                      Service Worker (manual, not generated)
├── manifest.json              (Note: PWA manifest is actually exported from src/app/manifest.ts; check which is canonical)
├── icon-192.png, icon-512.png PWA icons
└── …                          Other static files
```

> If `public/manifest.json` exists alongside `src/app/manifest.ts`, the route-exported one wins in Next.js 16 App Router. The `public/manifest.json` is then dead. Worth confirming during a cleanup pass.

## `docs/` — this vault

See [[../README]] for the canonical entry point and folder semantics.

## `.claude/`

```
.claude/
├── settings.local.json        Per-user permission allowlist + MCP server toggles
└── launch.json                Editor/dev launch config
```

Permissions granted include git, npm, Next.js commands, Vercel CLI, Supabase MCP, Railway MCP. See [[../06-ops/_README]] (when written) for the canonical list.

## `.github/`

```
.github/
└── dependabot.yml             Weekly npm minor/patch updates only
```

No CI workflows beyond Dependabot. Vercel handles deploys.

## Conventions enforced by this layout

- **Routes** live in `src/app/`. Route groups (`(app)`, `(auth)`) don't appear in URLs — they're for layout-sharing only.
- **Component primitives** (shadcn) live in `src/components/ui/`. Feature-domain components live under sibling `src/components/<area>/`.
- **Data-fetching hooks** are in `src/lib/hooks/`. Component-local hooks stay inside the component file.
- **Server-only modules** carry `import 'server-only'` at the top — see [[../_agent/conventions#supabase-clients]].
- **Path alias** `@/*` is the only allowed cross-folder import pattern.

## Files at a glance

Counts (approximate, as of `last_updated`):

| Area | Files |
|---|---|
| App routes (`src/app/**/page.tsx`) | 12 page files |
| API route handlers (`src/app/api/**/route.ts`) | 40 routes (v1.22.0 added `/api/ai/trip-plan` + `/api/trips/[id]/days/[dayId]`) |
| Feature components (`src/components/{assistant,filters,layout,map,places,settings}`) | ~27 |
| shadcn UI (`src/components/ui/`) | 19 primitives |
| Custom hooks (`src/lib/hooks/`) | 16 (v1.20.0 added: useSavedFilters) |
| Supabase clients (`src/lib/supabase/`) | 3 (browser, server, middleware) |
| Vault docs (`docs/**/*.md`, excl. `_archive`) | tracked in [[../CHANGELOG]] |
