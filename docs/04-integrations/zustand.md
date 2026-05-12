---
title: Zustand
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/stores/import-store.ts
related:
  - "[[../03-frontend/state-management]]"
  - "[[../03-frontend/stores/import-store]]"
---

# Zustand

The client-state store library. Used **sparingly** — only when state has to cross page boundaries and doesn't fit React Query or URL state.

## NPM package

- `zustand` `^5.0.13`

## Current stores

1. `useImportStore` (`src/lib/stores/import-store.ts`) — the only one. See [[../03-frontend/stores/import-store]].

That's it. State that doesn't survive navigation lives in `useState` or React Query. The one Zustand store exists because the batch import runs in a client-side loop that needs to survive route changes.

## Patterns this repo follows

- **Module-scope.** `create((set) => ({...}))` at top level — one store instance, persists for the app lifetime.
- **No middleware.** No `persist`, no `devtools`, no `subscribeWithSelector`. Plain `create`.
- **Actions inside the store.** All mutations are functions returned by `create`. Components call `useImportStore((s) => s.setFile)(...)`.
- **Direct state reads via selector.** `useImportStore((s) => s.phase)` — re-renders only when `phase` changes.

## When to add a new store

The bar is high. See [[../03-frontend/state-management#when-to-add-a-zustand-store]]. Concretely:

| Scenario | Pick |
|---|---|
| Data backed by Supabase / an API | React Query hook |
| State scoped to one component / its children | `useState` / `useReducer` |
| State worth in the URL | `useSearchParams` (see [[../03-frontend/hooks/use-filters]]) |
| Preference that should persist across reloads | `localStorage` (see [[../03-frontend/hooks/use-map-style]]) |
| State that crosses pages and isn't server data and doesn't fit above | **Zustand** |

## Devtools

`zustand/middleware` has a devtools wrapper. Not currently used. Adding it:

```ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const useImportStore = create(devtools((set) => ({ ... })));
```

Useful for replaying state transitions when debugging the import flow.

## Failure modes

- **Stale closure.** Reading `useImportStore.getState().cancelled` inside an async loop is fine; reading the store via `useImportStore((s) => ...)` captures the value at hook-call time. The import loop uses `getState()` for the live read.
- **Cross-tab.** Zustand state doesn't sync across tabs (no `persist` middleware). If a user has the import running in one tab, opening `/import` in another tab won't see the progress.

## Replacement strategy

A migration would be:

- React's `useReducer` with Context — verbose, but workable.
- **Jotai** — atom-based, similar feel, slightly different mental model.
- **Redux Toolkit** — overkill at our scale.

No reason to swap.
