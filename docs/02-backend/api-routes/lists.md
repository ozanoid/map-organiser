---
title: Lists routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/lists/[id]/reorder/route.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/lists]]"
  - "[[../schema/lists]]"
  - "[[../schema/list_places]]"
---

# Lists routes

Only **one** dedicated route handler exists for lists: the reorder endpoint. Standard CRUD (create / update / delete a list, add / remove places) is performed via direct Supabase calls from the frontend (`src/lib/hooks/use-lists.ts`) because RLS makes that safe.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/lists/[id]/reorder` | Replace `sort_order` for every list-place pair. |

## Per-route detail

### `PATCH /api/lists/[id]/reorder`

- **Source:** `src/app/api/lists/[id]/reorder/route.ts`
- **Auth:** required + ownership check on `lists.id`.
- **Body:** `{ placeIds: string[] }` — full ordered array of place IDs for this list.
- **DB:** `lists` SELECT (ownership); `list_places` UPDATE — one UPDATE per place_id, setting `sort_order = index`, via `Promise.all`.
- **Response:** `{ success: true }`. `200`, `400` on empty placeIds, `404` on list not owned/found.
- **Notes:** Parallel UPDATEs — a partial failure could leave the list in a half-reordered state. Hasn't bitten anyone yet but worth either a single SQL `CASE...WHEN` or a stored proc when this grows.

## Why no other route handlers

The pattern this app uses for any "simple CRUD where RLS is sufficient" is: skip the route handler, call Supabase from the client directly.

For lists, that means:

- **Create:** `supabase.from("lists").insert(...)` in `useLists()` mutations.
- **Update:** same with `.update(...).eq("id", id)`.
- **Delete:** same with `.delete().eq("id", id)`.
- **Add a place to a list:** `supabase.from("list_places").insert({ list_id, place_id, sort_order })`.
- **Remove a place from a list:** `supabase.from("list_places").delete().match({ list_id, place_id })`.

RLS guarantees:

- The user can only touch rows where `auth.uid() = user_id` (on `lists`).
- `list_places` rows go through the indirect predicate that walks up to `lists.user_id`.

The reorder endpoint exists because it does a bulk update of `sort_order` based on an array — that's awkward to express through a single Supabase client call without round-trips, so a dedicated handler made sense.

## Open questions

- **Transactional reorder.** The current `Promise.all` parallel UPDATEs aren't transactional. A failure mid-flight leaves the order partially updated. Replace with a single SQL statement using `CASE`, or a stored proc.
- **Should there be a `/api/lists` endpoint?** Today the answer is no — RLS-as-API works fine. If we add bulk operations (e.g. "delete these 3 lists"), reconsider.
