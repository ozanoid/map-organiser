---
title: State Management
type: overview
domain: frontend
version: 1.1.0
last_updated: 18.05.2026
status: stable
sources:
  - src/lib/providers.tsx
  - src/lib/hooks/
  - src/lib/stores/import-store.ts
related:
  - "[[_README]]"
  - "[[hooks/_README]]"
  - "[[stores/_README]]"
  - "[[../04-integrations/react-query]]"
  - "[[../04-integrations/zustand]]"
---

# State Management

Two layers, strictly separated:

- **Server state** — anything backed by Supabase or an API. Lives in **TanStack Query** (React Query) caches.
- **Client state** — UI state that doesn't come from the server. Lives in component state, URL state, **Zustand** stores, or `localStorage`.

These are not interchangeable. Picking the wrong one is the #1 cause of bugs in this codebase historically.

## React Query setup

`src/lib/providers.tsx`:

```tsx
"use client";
const [queryClient] = useState(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,        // 60s — most data stays fresh for a minute
          refetchOnWindowFocus: false, // don't burn API calls on tab focus
        },
      },
    })
);
```

- **`staleTime: 60_000`** — queries don't refetch automatically within 60s of the last successful fetch.
- **`refetchOnWindowFocus: false`** — explicit. Default Next.js dev experience would otherwise re-fire on every focus.
- **No `retry` override** — default retry behavior (3 retries with backoff) is fine.

## Query key conventions

| Entity | Query key | Source |
|---|---|---|
| Places (filtered) | `["places", filters]` | `usePlaces(filters)` |
| Categories | `["categories"]` | `useCategories()` |
| Subcategories | `["subcategories", { includePending }]` | `useSubcategories()` (Phase 2) |
| Tags | `["tags"]` | `useTags()` |
| Tags for a place | `["place-tags", placeId]` | `usePlaceTags(placeId)` |
| Lists | `["lists"]` | `useLists()` |
| Lists for a place | `["place-lists", placeId]` | `usePlaceLists(placeId)` |
| Trips (list) | `["trips"]` | `useTrips()` |
| Trip (detail) | `["trip", tripId]` | `useTrip(id)` |
| Stats | `["stats"]` | `useStats()` (staleTime override 5 min) |
| Shared link | `["shared-link", resourceType, resourceId]` | `useSharedLink(...)` (disabled by default) |
| AI suggestions | `["ai-suggestions"]` | `useAiSuggestions()` (Phase 5; pre-aggregated server-side; staleTime 30 s) |

**Pattern:** array starting with a stable string identifier (the entity name), then optional sub-arguments (filters, IDs).

**Invalidation conventions** (per [[hooks/_README]]):

- Place delete → `["places"]` + `["lists"]` + `["trips"]` (lists/trips counts change).
- Place mutation → `["places"]`.
- Category/tag/list mutation → its own key + `["places"]` (places carry joined data).
- Subcategory mutation → `["subcategories"]` + `["places"]` (places carry joined sub-cat data).
- Trip mutation → `["trips"]` (list refreshes counts) and/or `["trip", tripId]` (detail).
- AI suggestion accept → `["ai-suggestions"]` + `["tags"]` + `["subcategories"]` + `["places"]` (entity is created and joined onto places). Reject → only `["ai-suggestions"]`.

`PlaceFilters` carries `subcategory_ids?: string[]` alongside `category_ids` since Phase 2; URL-state mirror is `?subcategory=<id,id>` and the cascade filter UI (CategoryFilter) drives it.

## Server-state rules

- **All server data goes through React Query.** No raw `fetch` in components, no manual state with `useEffect`.
- **Hooks expose mutations**, not raw fetch calls. The mutation handles invalidation.
- **No global `staleTime` overrides** outside the QueryClient — set per-hook only when there's a reason (e.g. stats at 5 min).
- **Don't share query keys across hooks.** If two hooks read the same data, refactor to one hook with two `select` projections.

## Zustand setup

There's exactly **one** Zustand store today: `src/lib/stores/import-store.ts`.

Pattern:

```ts
import { create } from "zustand";

interface ImportState {
  phase: "idle" | "options" | "importing" | "done";
  // ... fields
  setFile: (name: string, size: number) => void;
  // ... actions
}

export const useImportStore = create<ImportState>((set) => ({ ... }));
```

- **Module-scope.** The store is created once at module import time, so state persists across page navigations (the user can leave `/import` and come back to a still-running import).
- **No persistence middleware.** State doesn't survive a full page reload.
- **No subscriptions / middleware** beyond `create`.

See [[stores/import-store]] for the full shape.

## When to add a Zustand store

The single existing store covers an unusual case: state that has to survive cross-page navigation but **isn't** server data. Most state doesn't need this. Use Zustand only when:

1. The state lives across multiple pages.
2. The state isn't on the server (so React Query is wrong).
3. URL/`localStorage` aren't appropriate (e.g. transient or too complex).

If any of these fails: use `useState`, URL state, or `localStorage`.

## URL state

`src/lib/hooks/use-filters.ts` shows the canonical URL-state pattern:

- Read from `useSearchParams()`.
- Write via `router.push(`${pathname}?${params}`)`.
- Sync local state on URL change (e.g. back/forward navigation).
- Debounce writes to avoid history thrash.

Used for filter state on `/places`, `/lists/[id]`, and (via prop drilling) `/map`.

## `localStorage` state

Used for UI preferences that should persist but not sync to the server:

- `map-style` / `marker-style` — managed by `useMapStyle()`.
- `theme` — managed by `next-themes` (key `theme`).

Read once on mount (with hydration guard for `next-themes`); write on change.

## Component-local state

Default for everything else. `useState`, `useReducer`, `useRef`. If a piece of state never leaves a component or its immediate children, keep it local.

## Anti-patterns

- ❌ **Context as a store.** Don't `createContext(null)` for shared state — Zustand is simpler and faster.
- ❌ **`useState` for server data.** Cache will drift. Use React Query.
- ❌ **`useEffect(() => fetch(...))`** — same. Always wrap in a React Query hook.
- ❌ **Mutating store from outside a component.** Use the store's actions, not direct `set` from random files.
- ❌ **Shadowing React Query cache with Zustand.** Pick one as the source of truth.

## Visualizing the boundary

```
┌──────────────────────────────────────────────────────────────┐
│ Server-backed                                                  │
│ • Places, trips, lists, categories, tags                       │
│ • Shared links, stats, profiles                                │
│ → TanStack React Query (src/lib/hooks/)                        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Cross-page client state                                        │
│ • Active import (file + progress + phase)                      │
│ → Zustand (src/lib/stores/)                                    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ URL state                                                      │
│ • Filters (?country=…&category=…&sort=…)                       │
│ → useSearchParams + router.push (use-filters)                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Persistent UI preferences                                      │
│ • Map style, marker style, theme                               │
│ → localStorage                                                 │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Local component state                                          │
│ • Dialog open/closed, input value, hover state                 │
│ → useState / useReducer / useRef                               │
└──────────────────────────────────────────────────────────────┘
```
