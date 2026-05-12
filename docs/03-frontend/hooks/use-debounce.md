---
title: useDebouncedCallback
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-debounce.ts
related:
  - "[[_README]]"
  - "[[use-filters]]"
---

# `useDebouncedCallback`

Generic debounce utility hook. Not React-Query; pure timing.

## Signature

```ts
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T
```

## Behavior

Returns a memoized callback that delays invoking `callback` until `delay` ms have passed since the last call. Internally uses `useRef` for the timeout and `useCallback` for stability. Clears the pending timeout on unmount.

## Consumers

- `src/lib/hooks/use-filters.ts` (debounces URL syncs by 300 ms).
- `src/components/filters/debounced-search-input.tsx` (400 ms search debounce).
- `src/components/filters/filter-sheet.tsx`, `filter-panel.tsx`, `list-filter.tsx`, `tag-filter.tsx`, `visit-status-filter.tsx` — anywhere a filter change should batch before pushing to URL state.
- `src/components/map/map-content.tsx` (map viewport change → `onVisiblePlacesChange`).

## Edge cases

- The hook intentionally **doesn't** support `flush()` or `cancel()` actions. If a consumer needs to fire immediately, it shouldn't debounce.
- Changing `delay` mid-life doesn't reset the in-flight timer (unusual but worth noting).
