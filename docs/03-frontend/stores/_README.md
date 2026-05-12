---
title: Stores
type: overview
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/stores/
related:
  - "[[../state-management]]"
  - "[[../_README]]"
  - "[[import-store]]"
---

# Stores

Zustand stores live in `src/lib/stores/`. Convention: file `<name>-store.ts` exports `useXStore`.

## Index

| Store | Purpose | Doc |
|---|---|---|
| `import-store.ts` | State for the batch import flow (file, options, progress, result) | [[import-store]] |

## When to add a new store

Default to NOT adding one. See [[../state-management#when-to-add-a-zustand-store]] — most state should be component-local, URL state, React Query, or `localStorage`. Add a Zustand store only when state must:

1. Survive page navigation, **and**
2. Not be server data, **and**
3. Not fit URL or `localStorage`.

Check this list seriously before adding. The current count is one for a reason.
