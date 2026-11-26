---
title: Layout components
type: component
domain: frontend
version: 1.3.0
last_updated: 26.11.2026
status: stable
sources:
  - src/components/layout/app-header.tsx
  - src/components/layout/app-sidebar.tsx
  - src/components/layout/mobile-nav.tsx
  - src/components/layout/offline-banner.tsx
  - src/components/layout/time-zone-sync.tsx
related:
  - "[[_README]]"
  - "[[../layouts]]"
  - "[[places]]"
  - "[[../../05-flows/instagram-import-flow]]"
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
- **Renders:** mobile-only logo + title; Add Place button; theme cycle button (Sun → Moon → Monitor); user avatar dropdown with initials, name, email, sign-out (which also clears the assistant's conversations and cache — `resetAssistantChat(queryClient)`).
- **Composes:** `AddPlaceDialog` from `places/`.
- **Instagram links (v1.28.1):** the header's `AddPlaceDialog` gets
  `onInstagramLink`, so it never runs an Instagram import itself. A pasted post
  link closes the dialog and `router.push`es `/map?add=<canonical post URL>` —
  the same entry the iOS Shortcut uses — keeping the current query string (the
  filters) when already on `/map` and dropping `ig`. The map page then runs the
  import with its progress, `?ig` refresh, map search, Show on map and
  background toast. See [[../../05-flows/instagram-import-flow]].
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
- **Used by:** the `(app)` layout (`src/app/(app)/layout.tsx`), under the header — every signed-in page. (Until 26.11.2026 this said the root layout; the code had it in `(app)`.)

## `TimeZoneSync`

- **File:** `src/components/layout/time-zone-sync.tsx` (v1.58.0, Phase 3 slice 2).
- **Props:** none. **Renders:** nothing.
- **Hooks:** `useEffect`, `useQueryClient`.
- **Behavior:** reads the browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`); if `localStorage["time-zone-synced"]` already holds it, stops. Otherwise `PUT /api/user/time-zone { timeZone, auto: true }` — the server stores it only while the profile has none, so a zone picked in Settings stays — then remembers it and invalidates `["notifications"]` (Settings, if open, shows it). Blocked storage: it simply asks again on the next visit.
- **Used by:** the `(app)` layout. See [[../hooks/use-notifications]], [[../../02-backend/api-routes/user]].

## Open questions

- **Header user fetch.** `AppHeader` does its own `getUser()` call. Could be lifted to a layout or a `useUser` hook for consistency.
- **No skeleton.** While `mounted` is `false`, the avatar dropdown renders nothing — the page is visible but the header section is partially empty. Worth a placeholder.
