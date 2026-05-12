---
title: Layouts
type: overview
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/layout.tsx
  - src/app/(app)/layout.tsx
  - src/app/(auth)/layout.tsx
  - src/app/shared/layout.tsx
  - src/components/layout/
related:
  - "[[_README]]"
  - "[[app-router-conventions]]"
  - "[[routing]]"
  - "[[design-system/_README]]"
  - "[[components/layout]]"
---

# Layouts

The layout hierarchy. App Router lets each segment own a layout that wraps its children. This repo has four layouts plus the root.

## Layout tree

```
src/app/layout.tsx                ← Root: html/body, fonts, Providers
├── src/app/(app)/layout.tsx       ← Authenticated shell (sidebar + header)
│   └── (every /map, /places, /lists, /trips, /stats, /import, /settings)
├── src/app/(auth)/layout.tsx      ← Centered minimal layout for /login + /signup
├── src/app/shared/layout.tsx      ← Standalone public layout for /shared/<slug>
└── (no group)
    ├── src/app/offline/page.tsx   ← Uses root only (PWA fallback)
    └── src/app/page.tsx           ← Index, root only
```

## Root layout (`src/app/layout.tsx`)

Owns:

- `<html lang="...">` + `<body>` with `font-sans antialiased`.
- Imports `globals.css`.
- Wraps children in `<Providers>` from `src/lib/providers.tsx`.
- Renders `<SwRegister />` (service worker registration) and `<OfflineBanner />` globally.
- Renders `<Toaster />` (sonner) for app-wide toasts.

Metadata:

```ts
export const metadata: Metadata = {
  title: "Map Organiser",
  description: "Organize your saved Google Maps locations",
  // ...
};
```

## `(app)` layout — authenticated shell

`src/app/(app)/layout.tsx`. Wraps all authenticated UI.

Children get:

- `<AppHeader />` — top bar with logo (mobile only), Add Place button, theme toggle, user avatar dropdown.
- `<AppSidebar />` — desktop-only collapsible sidebar with 6 nav links (Map, Places, Lists, Stats, Import, Settings).
- `<MobileNav />` — mobile-only bottom tab bar (Map, Places, Lists primary + More menu for Stats/Import/Settings).
- The page content area.

Behavior:

- Server Component (no `"use client"` at the top).
- Doesn't authenticate — middleware already gated the request.

Children: all `(app)/*` routes.

## `(auth)` layout — pre-auth shell

`src/app/(auth)/layout.tsx`. Wraps `/login` and `/signup`.

Children get:

- Centered minimal layout (no sidebar, no header).
- Logo and brand.
- Form area.

Children: `/login`, `/signup`.

## `shared/` layout — public share view

`src/app/shared/layout.tsx`. Wraps `/shared/<slug>`.

Children get:

- Standalone layout — no app chrome.
- Minimal header with brand + optional "Save to my account" CTA (rendered client-side based on session).
- No sidebar, no mobile nav.

Children: `/shared/[slug]/page.tsx`.

## Layout component sources

The actual layout chrome lives in `src/components/layout/`:

| Component | Source | Where it appears |
|---|---|---|
| `AppHeader` | `app-header.tsx` | `(app)` layout |
| `AppSidebar` | `app-sidebar.tsx` | `(app)` layout (desktop only) |
| `MobileNav` | `mobile-nav.tsx` | `(app)` layout (mobile only) |
| `OfflineBanner` | `offline-banner.tsx` | Root layout (whole app) |

See [[components/layout]] for the per-component breakdown.

## Responsive strategy

Tailwind breakpoints used in layouts:

| Breakpoint | Token | Behavior |
|---|---|---|
| `<768px` (mobile) | default | `MobileNav` visible, sidebar hidden. Header has hamburger / logo. |
| `≥1024px` (desktop) | `lg:` | `AppSidebar` visible, `MobileNav` hidden. |

No explicit "tablet" treatment — between mobile and desktop, the user gets the mobile UI.

## Loading / error / not-found

None of the layouts ship `loading.tsx`, `error.tsx`, or `not-found.tsx` today. Adding them would:

- `loading.tsx` — render during async server work in the segment.
- `error.tsx` — catch unhandled exceptions in the segment.
- `not-found.tsx` — handle `notFound()` calls or unmatched dynamic segments.

Worth a follow-up to at least add a global `not-found.tsx` so 404s aren't the raw Next.js default.

## Layout-level effects

- **Root layout** runs the service worker registration (`<SwRegister />`). The service worker is loaded once for the whole app.
- **OfflineBanner** subscribes to `window.online`/`window.offline` events.
- **No data fetching** happens in layouts today. All data is loaded from page components.
