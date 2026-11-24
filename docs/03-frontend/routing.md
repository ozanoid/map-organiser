---
title: Routing
type: overview
domain: frontend
version: 1.6.5
last_updated: 24.11.2026
status: stable
sources:
  - src/app/
  - src/proxy.ts
  - src/lib/supabase/proxy.ts
  - src/components/map/map-content.tsx
related:
  - "[[_README]]"
  - "[[app-router-conventions]]"
  - "[[layouts]]"
  - "[[proxy]]"
  - "[[../02-backend/api-routes/_README]]"
  - "[[../02-backend/auth]]"
---

# Routing

Every route in the app — pages, API handlers, and special routes — in one place. URLs are what the user sees; route groups (`(app)`, `(auth)`) don't appear in the path.

## Page routes

| Path | Source | Layout | Auth | Notes |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | root | Public | Landing/redirect page. |
| `/map` | `src/app/(app)/map/page.tsx` | `(app)/layout.tsx` | Required | Default post-login destination. Mapbox GL view. `?ids=a,b,…` (v1.48.0): only the places the assistant put on the map ("Show on map"), with an "N from the assistant" chip that clears it. |
| `/places` | `src/app/(app)/places/page.tsx` | `(app)/layout.tsx` | Required | Filter/search/sort the user's places. Takes the same `?ids=` filter and chip (v1.48.0). |
| `/places/[id]` | `src/app/(app)/places/[id]/page.tsx` | `(app)/layout.tsx` | Required | Place detail with tags, lists, photos, plan refs. |
| `/places/compare` | `src/app/(app)/places/compare/page.tsx` | `(app)/layout.tsx` | Required | S2 F-04 (v1.19.0): side-by-side 2-4 place comparison (`?ids=a,b,c`) + deliberate-click AI analysis. |
| `/lists` | `src/app/(app)/lists/page.tsx` | `(app)/layout.tsx` | Required | Lists + Plans tabbed view; `?tab=plans` opens the Plans tab. |
| `/lists/[id]` | `src/app/(app)/lists/[id]/page.tsx` | `(app)/layout.tsx` | Required | List detail with drag-and-drop reorder. |
| `/plans/[id]` | `src/app/(app)/plans/[id]/page.tsx` | `(app)/layout.tsx` | Required | Plan timeline + map (`?view=map`). `/trips/[id]` redirects here (308, `next.config.ts`). |
| `/stats` | `src/app/(app)/stats/page.tsx` | `(app)/layout.tsx` | Required | Recharts dashboard. |
| `/import` | `src/app/(app)/import/page.tsx` | `(app)/layout.tsx` | Required | Batch import with Zustand progress. |
| `/settings` | `src/app/(app)/settings/page.tsx` | `(app)/layout.tsx` | Required | Categories / Tags / API / Theme tabs. |
| `/login` | `src/app/(auth)/login/page.tsx` | `(auth)/layout.tsx` | **Public** (redirect if signed in) | Google OAuth + email/password. |
| `/signup` | — (page removed 17.11.2026) | — | Redirect | Sign-ups are closed; the proxy sends it to `/login`. |
| `/shared/[slug]` | `src/app/shared/[slug]/page.tsx` | `shared/layout.tsx` | **Public** | Public read view of a list, plan, or single place. |
| `/oauth/consent` | `src/app/(auth)/oauth/consent/page.tsx` | `(auth)/layout.tsx` | **Public** — the page itself sends signed-out visitors to `/login?next=…` | OAuth consent for the Claude connector (17.11.2026). See [[../05-flows/claude-connector-flow]]. |
| `/offline` | `src/app/offline/page.tsx` | root | Public — skips the proxy | PWA offline fallback; the service worker precaches it. |

## Special routes

| Path | Source | Purpose |
|---|---|---|
| `/auth/callback` | `src/app/auth/callback/route.ts` | OAuth code exchange. Public. See [[../02-backend/api-routes/auth-callback]]. |
| `/manifest.webmanifest` | `src/app/manifest.ts` | PWA manifest (Next.js native). Skips the proxy, so signed-out visitors get it too. |
| `/api/mcp` | `src/app/api/mcp/route.ts` | MCP endpoint for Claude (Streamable HTTP, bearer tokens). Skips the proxy. See [[../04-integrations/claude-mcp]]. |
| `/.well-known/oauth-protected-resource[/api/mcp]` | `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` | RFC 9728 metadata naming Supabase as the MCP endpoint's authorization server. Skips the proxy. |

## API routes (summary)

All under `/api/*`. Full detail in [[../02-backend/api-routes/_README]].

| Prefix | Group | Doc |
|---|---|---|
| `/api/places/*` | Places (11 endpoints) | [[../02-backend/api-routes/places]] |
| `/api/plans/*` | Plans (7 endpoints in 4 files) | [[../02-backend/api-routes/plans]] |
| `/api/visits/*` | Visits (4 endpoints in 2 files) | [[../02-backend/api-routes/visits]] |
| `/api/lists`, `/api/lists/[id]` | Lists — list, create; one list: read, `PATCH { set, ops }`, delete (v1.40.0) | [[../02-backend/api-routes/lists]] |
| `/api/shared/*` | Shared (4 endpoints incl. public GET) | [[../02-backend/api-routes/shared]] |
| `/api/stats` | Stats | [[../02-backend/api-routes/stats]] |
| `/api/user/*` | User (api-keys, usage) | [[../02-backend/api-routes/user]] |
| `/api/instagram/*` | Instagram import (3 endpoints — v1.28.0, plus the branch pick in v1.28.1) | [[../02-backend/api-routes/instagram]] |
| `/api/share-target` | PWA share target — **public POST** | [[../02-backend/api-routes/share-target]] |

## Proxy matcher

`src/proxy.ts`:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|api/mcp$|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Translation: runs on **every path except** static assets, image files, the service worker / manifest / offline page, the MCP endpoint and `.well-known` documents. So pages, API routes, the manifest, and the auth callback all go through the proxy before reaching their handler.

## Auth gating (from proxy)

```
Public routes (no auth required):
  /
  /auth/callback/*
  /shared/*
  /api/shared/*
  /api/cron/*      (the cron route authenticates itself)
  /oauth/*         (consent page; redirects to /login?next=… itself)

Auth routes (redirect AWAY if signed in — to a same-site ?next=…, else /map):
  /login

Closed (always redirect to /login):
  /signup

Everything else:
  Require auth — redirect to /login?next=<path> if not signed in (API paths: no next);
  sign-in returns to that path.
```

See [[../02-backend/auth#proxy-gate]] for the implementation.

## Dynamic segments

| Pattern | Used in | Param type (Next.js 16) |
|---|---|---|
| `[id]` | `/places/[id]`, `/lists/[id]`, `/plans/[id]`, `/api/places/[id]`, `/api/plans/[id]`, `/api/visits/[id]`, `/api/lists/[id]`, `/api/places/[id]/...`, `/api/plans/[id]/...`, `/api/instagram/import/[id]`, `/api/instagram/import/[id]/pick` | `Promise<{ id: string }>` |
| `[slug]` | `/shared/[slug]`, `/api/shared/[slug]`, `/api/shared/[slug]/save` | `Promise<{ slug: string }>` |
| `[dayId]` | `/api/plans/[id]/days/[dayId]/route` | combined: `Promise<{ id: string, dayId: string }>` |

**Next.js 16 quirk:** params are Promises — `await params` before using.

## Special URLs

- `/map?add=<url>` — used by the PWA share-target redirect, on iPhone by the iOS Shortcut "Add to MapOrganiser", and (v1.28.1) by the header's Add Place, which hands a pasted Instagram post link over this way. The map page reads `?add=...` client-side whenever it appears, opens the Add Place dialog pre-populated, then removes only `add` (`router.replace`), keeping the filters; the same link can come in again later. A Google Maps link gets the usual preview; an Instagram post/reel link switches the dialog to the Instagram import (v1.28.0, [[../05-flows/instagram-import-flow]]); any other Instagram link gets an inline "not a post" hint.
- `/map?ig=<jobId>` — v1.28.0. Set while the Add Place dialog shows an Instagram import, so a refresh reopens the dialog on that job. Only `ig` is added or removed (`router.replace`); the rest of the query string — the filters — is kept. Cleared when the dialog closes.
- `/login?error=auth_failed` — auth callback failure state.
- `/login?next=<path>` — (intended) redirect-back path after login. Verify the page reads it.

## How to add a new route

See [[../_agent/common-tasks#add-a-new-api-route]] for API routes. For pages:

1. Create `src/app/(app)/<name>/page.tsx` (or `(auth)/...` for public pages, or top-level for a sibling).
2. Default export an async or "use client" component.
3. Add to the auth gate's allow-list if it's public.
4. Add a nav link in `src/components/layout/app-sidebar.tsx` and `mobile-nav.tsx` if it should appear in navigation.
5. Update this table.
6. Log in [[../CHANGELOG]].
