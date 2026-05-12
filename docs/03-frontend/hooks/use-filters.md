---
title: useFilters
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-filters.ts
related:
  - "[[_README]]"
  - "[[use-debounce]]"
  - "[[use-places]]"
  - "[[../state-management#url-state]]"
---

# `useFilters`

The canonical URL-state hook. Bidirectional sync between local filter state and URL search params, with debounce.

## Signature

```ts
function useFilters(): {
  filters: PlaceFilters;
  setFilters: (newFilters: Partial<PlaceFilters>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
}
```

`PlaceFilters` (from `src/lib/types/index.ts`):

- `country`, `city` (strings)
- `category_ids`, `tag_ids` (string arrays)
- `list_id` (string)
- `rating_min`, `google_rating_min` (numbers)
- `visit_status` (enum)
- `search` (string)
- `sort` (string)

## Behavior

- Reads filters from `useSearchParams()` on every render.
- `setFilters(partial)` merges and pushes to URL via `router.push` after a 300 ms debounce.
- `clearFilters()` clears all params (replaces the URL).
- Tracks the last URL pushed (`lastPushedRef`) to **avoid infinite loops** when the URL changes externally (back/forward navigation).
- Empty arrays and `undefined` values are stripped from the URL.
- `hasActiveFilters` is `true` if any non-default filter is set — used by the filter UI to show a "Clear all" button.

## Dependencies

- `useSearchParams`, `usePathname`, `useRouter` from `next/navigation`.
- [[use-debounce|`useDebouncedCallback`]] (300 ms).

## Consumers

- `src/app/(app)/places/page.tsx`
- `src/app/(app)/lists/[id]/page.tsx` (when filtering within a list)
- `src/components/filters/filter-panel.tsx`
- `src/components/filters/filter-sheet.tsx`
- Indirectly by every filter component that delegates here.

## Edge cases

- **Back/forward navigation:** the `lastPushedRef` check prevents a loop where (a) the URL changes externally, (b) the hook detects new filters, (c) it re-pushes a URL, (d) re-renders trigger another push.
- **Race with mutations:** `usePlaces(filters)` re-fires when `filters` changes. Debouncing the URL push (300 ms) avoids spamming the API on rapid filter changes (typing in search box, dragging a range slider).
- **Filter shape mismatches.** If `PlaceFilters` adds a field, the serializer must learn how to encode/decode it. Today the supported keys are hard-coded.
