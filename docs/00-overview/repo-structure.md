---
title: Repo Structure
type: overview
domain: overview
version: 1.0.0
last_updated: 12.05.2026
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
│   │   ├── lists/page.tsx     Lists + Trips tabs
│   │   ├── lists/[id]/page.tsx
│   │   ├── trips/[id]/page.tsx Timeline + map
│   │   ├── stats/page.tsx     Recharts dashboard
│   │   ├── import/page.tsx    Batch import + Zustand progress
│   │   └── settings/page.tsx  Categories/Tags/API/Theme tabs
│   ├── (auth)/                Public auth pages (route group)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── auth/callback/route.ts OAuth callback handler
│   ├── shared/[slug]/page.tsx Public share view (no auth)
│   ├── shared/layout.tsx
│   ├── offline/page.tsx       PWA offline fallback
│   └── api/                   Route handlers (see [[../02-backend/api-routes/_README]])
│       ├── places/            CRUD + bulk + enrich + import + parse-link + migrate-photos
│       ├── trips/             CRUD + auto-plan + day reorder + day places + swap-days
│       ├── lists/[id]/reorder
│       ├── shared/            Create + public-read + save-to-account
│       ├── stats/             Aggregated stats
│       ├── user/              api-keys + usage
│       └── share-target/      PWA share_target sink
├── components/
│   ├── filters/               Category / country-city / list / tag / visit-status / search filter UIs
│   ├── layout/                AppHeader, AppSidebar, MobileNav, OfflineBanner
│   ├── map/                   MapView, MapContent
│   ├── places/                PlaceCard, AddPlaceDialog, BulkActionBar, inline creators, VisitStatusToggle
│   ├── settings/              ApiKeysManager, CostTracker
│   ├── sw-register.tsx        Service worker registration (client component)
│   └── ui/                    shadcn primitives (avatar, badge, button, card, command, dialog, dropdown-menu, input, input-group, popover, select, separator, sheet, skeleton, sonner, tabs, textarea)
└── lib/
    ├── dataforseo/            DataForSEO client + types + adapters + transform + reviews + photo
    ├── google/                Google Places + URL parser + category mapping + Takeout parser + usage tracker + key access
    ├── hooks/                 React Query hooks: useCategories, useDebounce, useFilters, useLists, useMapStyle, usePlaces, useSharedLinks, useStats, useTags, useTrips
    ├── stores/                Zustand stores (currently just import-store.ts)
    ├── map/                   category-icons.ts (canvas marker rendering)
    ├── trip/                  auto-plan.ts (k-means clustering), directions.ts (Mapbox wrapper)
    ├── supabase/              client.ts (browser), server.ts (+ createServiceClient), middleware.ts (updateSession)
    ├── types/                 index.ts — domain types (Place, Trip, Category, Tag, …)
    ├── geo.ts                 Shared PostGIS point parser (EWKB hex / WKT / GeoJSON / plain object)
    ├── providers.tsx          ThemeProvider + QueryClientProvider
    └── utils.ts               cn() Tailwind class merger
```

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
| API route handlers (`src/app/api/**/route.ts`) | ~24 routes |
| Feature components (`src/components/{filters,layout,map,places,settings}`) | ~25 |
| shadcn UI (`src/components/ui/`) | 19 primitives |
| Custom hooks (`src/lib/hooks/`) | 10 |
| Supabase clients (`src/lib/supabase/`) | 3 (browser, server, middleware) |
| Vault docs (`docs/**/*.md`, excl. `_archive`) | tracked in [[../CHANGELOG]] |
