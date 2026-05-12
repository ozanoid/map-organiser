---
title: useCategories
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-categories.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/categories-and-tags]]"
  - "[[../../02-backend/schema/categories]]"
---

# `useCategories`

React Query hook for the current user's categories. Three exports: a query and two mutations.

## Signature

```ts
function useCategories(): UseQueryResult<Category[], Error>
function useCreateCategory(): UseMutationResult<Category, Error, { name: string; color?: string; icon?: string }>
function useDeleteCategory(): UseMutationResult<void, Error, string>
```

## Behavior

- **`useCategories`** — direct Supabase `select * from categories order by sort_order asc`. Query key `["categories"]`. Default staleTime (60s).
- **`useCreateCategory`** — inserts a row scoped to `auth.uid()`. Invalidates `["categories"]`.
- **`useDeleteCategory`** — deletes by ID. Invalidates `["categories"]` AND `["places"]` (because places carry joined category data and the marker would otherwise still show the old category).

## Dependencies

- Direct: `@supabase/ssr` browser client (via `createClient` in `src/lib/supabase/client.ts`).
- Other hooks: none.

## Consumers

- `src/components/filters/category-filter.tsx`
- `src/components/map/map-content.tsx`
- `src/components/places/add-place-dialog.tsx`
- `src/components/places/bulk-action-bar.tsx`
- `src/components/places/inline-category-creator.tsx`
- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/lists/[id]/page.tsx`
- `src/app/(app)/trips/[id]/page.tsx`

## Edge cases

- New users have 12 default categories seeded by trigger on signup — see [[../../01-domain/users-and-profiles#signup-first-use-flow]].
- Deleting a category sets `places.category_id = NULL` for affected places (FK is `ON DELETE NO ACTION` and `places.category_id` is nullable — verify whether the delete cascades to null or errors on referenced rows; if it errors, `useDeleteCategory` would need to clear references first).
- No optimistic updates — UI shows a loading state during the round-trip.
