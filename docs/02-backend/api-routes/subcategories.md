---
title: Subcategories routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - src/app/api/subcategories/route.ts
  - src/app/api/subcategories/[id]/route.ts
related:
  - "[[_README]]"
  - "[[../schema/subcategories]]"
  - "[[../../03-frontend/hooks/use-subcategories]]"
---

# Subcategories routes

CRUD endpoints for per-user subcategories. All require auth and rely on RLS
for ownership scoping.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/subcategories` | List user's subcategories. Excludes `is_pending` rows by default; pass `?include_pending=true` for the moderation queue. |
| `POST` | `/api/subcategories` | Create a user-defined subcategory under one of the user's parent categories. |
| `PATCH` | `/api/subcategories/[id]` | Rename or flip `is_pending` (Phase 5 approve). |
| `DELETE` | `/api/subcategories/[id]` | Delete. Places using it fall back to NULL via `ON DELETE SET NULL`. |

---

## Per-route detail

### `GET /api/subcategories`

- **Source:** `src/app/api/subcategories/route.ts`
- **Query:** `include_pending` (`true` to include AI proposals; default `false`).
- **DB:** `subcategories` SELECT scoped by RLS.
- **Response:** `{ subcategories: Subcategory[] }`. `200`, `401`.

### `POST /api/subcategories`

- **Body:** `{ parent_category_id: uuid, name: string, slug?: string }` (Zod-validated).
- **DB:** verifies parent exists (RLS-scoped); inserts new row with `is_default: false`, `is_pending: false`, `approved_at: now()`. `slug` derived from `name` via `normalize()` if omitted.
- **Response:** `{ subcategory: Subcategory }`. `200`, `400` (bad body), `404` (parent not owned/found), `409` (duplicate slug under that parent), `401`.

### `PATCH /api/subcategories/[id]`

- **Body:** `{ name?, is_pending? }` (at least one required, Zod-validated).
- **DB:** `subcategories` UPDATE. When `is_pending: false` is set, `approved_at = now()`.
- **Response:** `{ subcategory: Subcategory }`. `200`, `400`, `404`, `401`.

### `DELETE /api/subcategories/[id]`

- **DB:** `subcategories` DELETE. FK cascade: `places.subcategory_id` SET NULL.
- **Response:** `{ success: true }`. `200`, `401`, `500`.

## Cross-route concerns

- **Ownership** is enforced entirely by RLS. The user-scoped Supabase client is sufficient; no manual `.eq("user_id", user.id)` redundancy.
- **`POST` slug derivation** uses `src/lib/ai/normalize.ts#normalize` so manually-created subcategories produce slugs consistent with the AI proposal path.
- **No bulk operations** today. A bulk-delete (e.g. "wipe all defaults for X parent") would need its own endpoint.

## Open questions

- **Sub-category reorder**: no `sort_order` column. UI currently renders alphabetically. If user demand emerges, add `sort_order` + a `/reorder` endpoint mirroring `/api/lists/[id]/reorder`.
- **Pending approval bulk**: Phase 5 moderation queue may want `POST /api/subcategories/approve-bulk` to flip many `is_pending` at once.
