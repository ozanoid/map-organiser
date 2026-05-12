---
title: TanStack React Query
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/providers.tsx
  - src/lib/hooks/
related:
  - "[[../03-frontend/state-management]]"
  - "[[../03-frontend/hooks/_README]]"
---

# TanStack React Query

The server-state cache. Every server-backed read/write in the app goes through a React Query hook in `src/lib/hooks/`.

## NPM package

- `@tanstack/react-query` `^5.100.9`

## Wiring

`src/lib/providers.tsx` (Client Component, mounted in the root layout):

```tsx
const [queryClient] = useState(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          refetchOnWindowFocus: false,
        },
      },
    })
);
```

Why `useState` to hold the client: ensures one instance per app lifecycle. Without it, hot reloads would mint new clients and lose caches.

## Defaults applied

| Option | Default in this repo | Reason |
|---|---|---|
| `staleTime` | 60_000 ms | Most data is fine for a minute. |
| `refetchOnWindowFocus` | `false` | Tab focus shouldn't burn API budget. |
| `retry` | (library default — 3) | Fine for our flaky-network tolerance. |
| `gcTime` | (library default — 5 min) | Unused cache slots clear quickly. |

Per-hook overrides:

- [[../03-frontend/hooks/use-stats|`useStats`]] uses `staleTime: 5 * 60 * 1000` (5 min).

No other hook overrides defaults.

## Patterns the codebase enforces

1. **One hook per entity.** `usePlaces`, `useTrips`, etc. — each owns its query keys.
2. **Stable namespaced query keys.** `["places", filters]`, `["trip", id]`, `["place-tags", placeId]`. See [[../03-frontend/state-management#query-key-conventions]].
3. **Mutations live with their query.** `useCreatePlace` is exported from `use-places.ts`, not a separate file.
4. **Invalidation, not manual cache writes.** With one exception ([[../03-frontend/hooks/use-shared-links|`useSharedLink`]] mutations use `setQueryData` for optimistic-ish updates), mutations call `queryClient.invalidateQueries({...})` and let React Query refetch.
5. **No `<Hydrate>` for SSR.** App Router pages either render Server Components (no React Query needed) or fetch client-side on mount.

## When NOT to use React Query

- **Pure client UI state** — useState / useReducer. See [[../03-frontend/state-management]].
- **State that crosses pages but isn't server data** — Zustand (see [[zustand]]).
- **URL state** — `useSearchParams` (see [[../03-frontend/hooks/use-filters]]).

## Devtools

React Query Devtools is **not currently mounted**. Adding it:

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
// ... inside Providers, after QueryClientProvider opens:
<ReactQueryDevtools initialIsOpen={false} />
```

Useful for debugging cache invalidation and stale state. Worth adding for dev builds.

## Failure modes

- **Network error:** the hook's `error` is set; retries kick in (3 with backoff). UI should handle `isError`.
- **Stale data after a mutation:** invalidation didn't include the right key. Pattern fix: when adding a mutation, write down which keys are affected before coding.
- **Infinite refetch loop:** usually caused by a non-stable query key (object literal recreated each render). Fix: memoize or move the key out of render.

## Replacement strategy

React Query is foundational to this codebase. A swap would mean re-writing every hook. Realistic alternatives:

- **SWR** — similar API, less feature-complete. Drop-in for read-only patterns; mutations would need refactor.
- **Apollo** — only sane with GraphQL.
- **Roll your own with `useEffect`** — strongly discouraged.

No reason to swap at present.
