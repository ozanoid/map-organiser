---
title: useSubcategories
type: hook
domain: frontend
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - src/lib/hooks/use-subcategories.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/categories-and-tags]]"
  - "[[../../02-backend/schema/subcategories]]"
  - "[[../../02-backend/api-routes/subcategories]]"
---

# `useSubcategories` and family

React Query hooks for per-user subcategories. Three exports: the list query
plus two mutations.

## Signatures

```ts
function useSubcategories(options?: { includePending?: boolean }):
  UseQueryResult<Subcategory[], Error>

function useCreateSubcategory():
  UseMutationResult<
    Subcategory,
    Error,
    { parent_category_id: string; name: string; slug: string }
  >

function useDeleteSubcategory(): UseMutationResult<void, Error, string>
```

## Behavior

| Hook | Source | Invalidates |
|---|---|---|
| `useSubcategories({ includePending: false })` | Supabase `select * from subcategories where is_pending = false` order name asc. Default. | — |
| `useSubcategories({ includePending: true })` | Same, no pending filter. Used by Phase 5 moderation queue. | — |
| `useCreateSubcategory` | Supabase insert. `is_default: false`, `is_pending: false`, `approved_at: now()`. | `["subcategories"]` |
| `useDeleteSubcategory` | Supabase delete by id. | `["subcategories"]`, `["places"]` |

## Query key shape

`["subcategories", { includePending: boolean }]` — two cache slots, one per flag. The Settings tab uses `false` (default), the future moderation queue UI uses `true`.

## Consumers

- `src/components/filters/category-filter.tsx` — cascade UI (`includePending: false`).
- `src/app/(app)/settings/page.tsx` — `CategoryRow` inline manage UI.
- (Phase 5) `src/components/settings/ai-suggestions.tsx` — moderation queue, will use `includePending: true`.

## Edge cases

- **New user signup**: 62 default subcategories arrive via DB trigger before the user's first `useSubcategories()` call resolves.
- **Existing users** were backfilled by the migration; no client-side action required.
- **`useDeleteSubcategory` invalidates `["places"]`** because places carry joined subcategory data (`subcategory:subcategories(*)` in `/api/places`). Cards/detail would otherwise show stale subcategory names until refetch.
- **No optimistic updates** — UI shows brief loading state during the round-trip. Acceptable at the current dataset size.
