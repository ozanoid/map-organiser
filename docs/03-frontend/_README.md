---
title: Frontend Overview
type: overview
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/
  - src/components/
  - src/lib/hooks/
  - src/lib/stores/
  - src/lib/providers.tsx
  - src/middleware.ts
related:
  - "[[app-router-conventions]]"
  - "[[routing]]"
  - "[[layouts]]"
  - "[[state-management]]"
  - "[[middleware]]"
  - "[[pwa-and-offline]]"
  - "[[design-system/_README]]"
  - "[[hooks/_README]]"
  - "[[stores/_README]]"
  - "[[components/_README]]"
---

# Frontend Overview

The Next.js client. Everything under `src/app/`, `src/components/`, and the client-side pieces of `src/lib/`. Server-side route handlers are documented in [[../02-backend/api-routes/_README]].

## Stack baseline

- **Next.js 16 App Router** with route groups `(app)` and `(auth)`.
- **React 19**, Server Components by default, `"use client"` opt-in.
- **Tailwind v4** with `@theme inline` tokens in `src/app/globals.css`.
- **shadcn/ui** `base-nova` style. Primitives in `src/components/ui/`.
- **TanStack Query** for server state, **Zustand** for client state.
- **`next-themes`** for light/dark/system.

## Doc map

| Topic | Doc |
|---|---|
| App Router conventions used here | [[app-router-conventions]] |
| Every route (page + API) | [[routing]] |
| Layouts and route groups | [[layouts]] |
| State management (Zustand + React Query) | [[state-management]] |
| Middleware (auth gate) | [[middleware]] |
| PWA, service worker, offline route | [[pwa-and-offline]] |
| Design system (tokens, shadcn, fonts, dark mode) | [[design-system/_README]] |
| Custom React Query hooks | [[hooks/_README]] |
| Zustand stores | [[stores/_README]] |
| Feature component families | [[components/_README]] |

## Top-level surface

| Surface | Count |
|---|---|
| App Router pages | 12 (`src/app/**/page.tsx`) |
| Layouts | 5 (root, `(app)`, `(auth)`, `shared`, `offline` is a page) |
| API route handlers | ~24 (documented in [[../02-backend/api-routes/_README]]) |
| Feature components | ~25 (filters, layout, map, places, settings) |
| shadcn UI primitives | 19 (in `src/components/ui/`) |
| Custom hooks | 10 |
| Zustand stores | 1 (`import-store`) |

## Cross-cutting conventions

The same conventions documented in [[../_agent/conventions]] apply. Reminders relevant here:

- **`"use client"` is contagious.** Push it to leaves; keep `page.tsx` server-side when possible.
- **Server state → React Query hook.** Don't `useEffect(fetch)` — use the hook in `src/lib/hooks/`.
- **Cross-page client state → Zustand store.** Component state → `useState`/`useReducer`. No Context-as-store.
- **Tailwind only.** No CSS modules, no inline styles for theming (use tokens).
- **shadcn primitives.** Don't roll your own button; install or compose from `src/components/ui/`.
- **`cn()`** from `src/lib/utils.ts` for conditional classes.
- **Path alias** `@/*` exclusively.

## Known inconsistencies

- **Design system master vs reality.** `design-system/master.md` (preserved from a prior generation) specifies an emerald/orange palette and `Inter` fonts. The actual implementation in `globals.css` uses grayscale `oklch` tokens (shadcn defaults) and `Geist` fonts. See [[design-system/_README]] for the reconciliation note.
- **PWA manifest source.** `src/app/manifest.ts` is the canonical Next.js manifest export. If `public/manifest.json` also exists, the route-exported one wins. Cleanup pass needed (see [[pwa-and-offline]]).
