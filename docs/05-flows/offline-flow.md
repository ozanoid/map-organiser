---
title: Offline Flow
type: flow
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - public/sw.js
  - src/components/sw-register.tsx
  - src/components/layout/offline-banner.tsx
  - src/app/offline/page.tsx
related:
  - "[[../03-frontend/pwa-and-offline]]"
---

# Offline Flow

What happens to the app when network drops.

## Trigger

The browser fires the `offline` event (`navigator.onLine === false`). Causes:

- User loses WiFi / cellular.
- Service worker can't reach the network for a navigation request.
- Browser flips to offline mode (DevTools).

## Steps

```
1. Browser fires "offline" event
       │
       ▼
2. OfflineBanner (root layout) listens to window.offline:
       │  setIsOffline(true)
       │  Renders amber banner at top: "You're offline" + WifiOff icon
       │
       ▼
3. User actions split:
       │
       ├─ Read existing UI (already in memory)
       │     • React Query holds last-fetched data → cards / map / lists still render
       │     • No new fetches → silent staleness
       │
       ├─ User triggers a mutation (toggle visit status, add place, etc.)
       │     • Mutation hook calls fetch → throws network error
       │     • UI shows toast / error state
       │     • No queue, no retry on reconnect
       │
       └─ User navigates to an un-visited route
             │
             ▼
4. SW intercepts the navigation
             │  • If the path is cached → serve cached HTML/JS/CSS
             │  • Else → serve /offline (PWA fallback page)
             │
             ▼
5. /offline page:
             │  • Standalone (root layout, no app chrome)
             │  • Self-contained — no API calls
             │  • Reassures user: "You're offline. We'll be right back."
             │
             ▼ (when network returns)
6. Browser fires "online" event
       │
       ▼
7. OfflineBanner hides
       │
       ▼ (user interaction triggers a fetch / mutation)
8. React Query refetches stale queries on next access
       │  (no automatic refetch — defaults have refetchOnWindowFocus: false)
```

## Service worker behavior

`public/sw.js`. Verify exact strategies in the file:

- **install:** pre-cache `/offline`, key static assets.
- **fetch:** for navigation requests, try network first; on failure, serve the cached response or `/offline`.
- **activate:** clean up old caches keyed by version.

## What works offline

- Pages already rendered in memory (no re-fetch).
- Cached JS / CSS for navigations to seen routes.
- Mapbox tile cache (Mapbox does its own tile caching).
- `localStorage`-backed UI preferences (map style, theme).

## What does NOT work offline

- Any mutation (`POST` / `PATCH` / `DELETE`) — fails immediately.
- Fresh API data (places list refresh, stats, etc.).
- Mapbox Directions API — trip routes won't compute.
- Google Places / DataForSEO — parse-link / enrichment fail.
- Save-to-account on `/shared/<slug>` — fails.

## Edge cases

- **Half-cached pages.** If only some of a page's JS chunks are cached, navigation may render then white-screen. Browser tooling shows this; users see "broken".
- **PWA installed, no SW yet.** First launch of the installed app while offline: nothing loads. The SW has to install on at least one online visit.
- **Stale SW.** A deploy ships a new SW. The user keeps the old one until tab close + reopen. See [[../03-frontend/components/sw-register#open-questions]].

## Related code

- `public/sw.js` — service worker source.
- `src/components/sw-register.tsx` — registers the SW at app boot.
- `src/components/layout/offline-banner.tsx` — the amber banner.
- `src/app/offline/page.tsx` — the PWA fallback page.
- `src/app/manifest.ts` — PWA manifest (start_url, display).

## Open questions

- **Background sync for mutations.** If the user toggles visit status while offline, queue the mutation to retry on reconnect. Today it just fails. Requires the SW to intercept POST/PATCH bodies and replay them — non-trivial.
- **Selective offline pre-cache.** Pre-loading the user's places JSON on install would make `/places` feel fully offline-capable. Today it depends on what the user has visited.
- **SW update notification.** Add a toast on `controllerchange` offering reload after a deploy.
