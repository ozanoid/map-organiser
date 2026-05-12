---
title: sw-register
type: component
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/components/sw-register.tsx
  - public/sw.js
related:
  - "[[_README]]"
  - "[[../pwa-and-offline]]"
---

# `SwRegister`

A tiny Client Component that registers the service worker at app boot.

- **File:** `src/components/sw-register.tsx`
- **`"use client"`** (touches `navigator.serviceWorker`).
- **Props:** none.
- **Hooks:** `useEffect`.
- **Behavior:** on mount, if `navigator.serviceWorker` is available, calls `navigator.serviceWorker.register("/sw.js")`. Logs success/failure to the console.
- **Renders:** `null`.
- **Used by:** root layout (`src/app/layout.tsx`) — once per app.

For SW behavior itself (caching, offline fallback), see [[../pwa-and-offline]].

## Open questions

- **No update notifications.** When a new SW activates, the user keeps the old version until the tab fully closes. A `controllerchange` listener with a toast offering reload would improve perceived freshness after a deploy.
