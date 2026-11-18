---
title: useSharedLinks
type: hook
domain: frontend
version: 1.2.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/hooks/use-shared-links.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/sharing]]"
  - "[[../../02-backend/api-routes/shared]]"
---

# `useSharedLink` and family

Four exports for the public-sharing surface.

## Signatures

```ts
// v1.20.0 (NF-18): resource_type unions widened to include "place"
function useSharedLink(
  resourceType: SharedResourceType, // "list" | "plan" | "place"
  resourceId: string | undefined
): UseQueryResult<SharedLink | null, Error>

function useCreateSharedLink(): UseMutationResult<
  SharedLink,
  Error,
  { resource_type: SharedResourceType; resource_id: string }
>

function useToggleSharedLink(): UseMutationResult<
  SharedLink,
  Error,
  { id: string; is_active: boolean }
>

function useSaveSharedContent(): UseMutationResult<
  { type: string; id: string },
  Error,
  string  // slug
>
```

## Behavior

| Hook | Source | Invalidates / cache updates |
|---|---|---|
| `useSharedLink(type, id)` | **Disabled by default** (`enabled: false`). The UI fetches manually when needed (e.g. opening the share dialog). Query key `["shared-link", resourceType, resourceId]`. | — |
| `useCreateSharedLink` | `POST /api/shared`. | `setQueryData(["shared-link", ...], newLink)` — optimistic cache update. |
| `useToggleSharedLink` | `PATCH /api/shared`. | `setQueryData(["shared-link", ...], updatedLink)`. |
| `useSaveSharedContent(slug)` | `POST /api/shared/[slug]/save`. | Invalidates `["lists"]`, `["plans"]`, `["places"]` — the viewer just gained new rows. |

## Consumers

- `src/app/shared/[slug]/page.tsx` — `useSaveSharedContent`.
- `src/app/(app)/lists/[id]/page.tsx` — `useCreateSharedLink`, `useToggleSharedLink`.
- `src/components/plans/plan-menu.tsx` — "Copy share link" in the plan menu (`resource_type: "plan"`; falls back to showing the link when the clipboard isn't available).

## Edge cases

- **Disabled query:** `useSharedLink` returns no data until `enabled` flips. Consumers either call `queryClient.fetchQuery({...})` manually, or read via `setQueryData` from a sibling mutation's success handler.
- **`useSaveSharedContent` invalidates three caches** because the save can create both a new list/plan AND new places (when the viewer doesn't already have them).
- **`is_active` toggle is idempotent.** Calling toggle with the current value would still PATCH; consider a guard if the UI ever spams it.
