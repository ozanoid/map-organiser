---
title: Layout components
type: component
domain: frontend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - src/components/layout/app-header.tsx
  - src/components/layout/app-sidebar.tsx
  - src/components/layout/mobile-nav.tsx
  - src/components/layout/offline-banner.tsx
related:
  - "[[_README]]"
  - "[[../layouts]]"
---

# Layout components

App chrome. All `"use client"`. Rendered by `src/app/(app)/layout.tsx` (header/sidebar/nav) and `src/app/layout.tsx` (offline banner).

## `AppHeader`

> **v1.21.0:** gained the assistant ✨ launcher (`AssistantLauncher`, mounted left of Add Place) — see [[assistant]].

- **File:** `src/components/layout/app-header.tsx`
- **Props:** none.
- **Hooks:** `useRouter`, `useState`, `useEffect`, `useTheme` (next-themes).
- **API/DB:** `supabase.auth.getUser()` for current user.
- **State:** `addOpen` (Add Place dialog), `mounted` (hydration guard), `user` (auth user), `theme`.
- **Shadcn used:** `Button`, `DropdownMenu` family, `Avatar`/`AvatarFallback`/`AvatarImage`.
- **Renders:** mobile-only logo + title; Add Place button; theme cycle button (Sun → Moon → Monitor); user avatar dropdown with initials, name, email, sign-out.
- **Composes:** `AddPlaceDialog` from `places/`.
- **Used by:** `(app)/layout.tsx`.

## `AppSidebar`

- **File:** `src/components/layout/app-sidebar.tsx`
- **Props:** none.
- **Hooks:** `usePathname`, `useState`.
- **State:** `collapsed` (toggle between `w-56` and `w-16`).
- **Shadcn used:** `Button`.
- **Renders:** logo + 6 nav items (Map, Places, Lists, Stats, Import, Settings). Active state via pathname match. Collapse arrow at top.
- **Visibility:** desktop only (`hidden lg:flex`).
- **Used by:** `(app)/layout.tsx`.

## `MobileNav`

- **File:** `src/components/layout/mobile-nav.tsx`
- **Props:** none.
- **Hooks:** `usePathname`, `useState`.
- **State:** `moreOpen` (More overlay).
- **Renders:** bottom tab bar with 3 primary tabs (Map, Places, Lists) + a "More" button. More overlay shows Stats / Import / Settings.
- **Visibility:** mobile only (`lg:hidden`).
- **Notes:** `safe-area-pb` padding for notched devices. Overlay click closes the menu.

## `OfflineBanner`

- **File:** `src/components/layout/offline-banner.tsx`
- **Props:** none.
- **Hooks:** `useState`, `useEffect`.
- **State:** `isOffline`.
- **Renders:** fixed banner at `top-14` with amber color + `WifiOff` icon. Visible only when offline.
- **Behavior:** listens to `window.online` and `window.offline` events; checks `navigator.onLine` on mount.
- **Used by:** root layout (`src/app/layout.tsx`) — visible across every page.

## Open questions

- **Header user fetch.** `AppHeader` does its own `getUser()` call. Could be lifted to a layout or a `useUser` hook for consistency.
- **No skeleton.** While `mounted` is `false`, the avatar dropdown renders nothing — the page is visible but the header section is partially empty. Worth a placeholder.
