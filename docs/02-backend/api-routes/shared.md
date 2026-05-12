---
title: Shared routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/shared/route.ts
  - src/app/api/shared/[slug]/route.ts
  - src/app/api/shared/[slug]/save/route.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/sharing]]"
  - "[[../schema/shared_links]]"
  - "[[../supabase-clients#serverts-createserviceclient---bypass-rls]]"
  - "[[../auth#public-route-table]]"
---

# Shared routes

Three route handlers for the public-sharing surface. **This is the only group with a public-facing endpoint** — `GET /api/shared/[slug]` uses the service-role client to bypass RLS.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/shared` | required | Create (or return existing) share link for a list/trip the user owns. |
| `PATCH` | `/api/shared` | required | Toggle `is_active` on a share link. |
| `GET` | `/api/shared/[slug]` | **PUBLIC** (service role) | Resolve slug → payload. Increment view count. |
| `POST` | `/api/shared/[slug]/save` | required (viewer) | Copy the shared resource into the viewer's account. |

The `/api/shared/*` prefix is explicitly exempt from the auth-required middleware gate (`src/lib/supabase/middleware.ts`).

---

## Per-route detail

### `POST /api/shared`

- **Source:** `src/app/api/shared/route.ts`
- **Auth:** required.
- **Body:** `{ resource_type: "list"|"trip", resource_id: uuid }`.
- **DB:** ownership check on `lists.id` or `trips.id`; `shared_links` SELECT (existing) + INSERT (new).
- **External:** `nanoid(10)` for slug.
- **Response:** Returns existing or new share link `{ id, slug, ... }`. `200`, `400` on bad resource_type, `404` if resource not owned.
- **Notes:** **Idempotent** — returns the existing link if `(user_id, resource_type, resource_id)` is already shared. No duplicates.

### `PATCH /api/shared`

- **Source:** `src/app/api/shared/route.ts`
- **Auth:** required.
- **Body:** `{ id: uuid, is_active: boolean }`.
- **DB:** `shared_links` UPDATE.
- **Response:** Updated link.
- **Notes:** Disabling sets `is_active = false`. The link's slug now 404s (or rather: the public read returns 404 because the partial index `idx_shared_links_slug WHERE is_active = true` won't match).

### `GET /api/shared/[slug]`

- **Source:** `src/app/api/shared/[slug]/route.ts`
- **Auth:** **PUBLIC** — uses `createServiceClient()` to bypass RLS.
- **DB (service role):** `shared_links` SELECT + UPDATE (view_count++); `profiles` SELECT (owner name); then either:
  - **List path:** `lists` SELECT + `list_places` SELECT + `places` SELECT joined with `categories`.
  - **Trip path:** `trips` SELECT + `trip_days` SELECT + `trip_day_places` SELECT joined with `places` + `categories`.
- **External:** `getRoute` (Mapbox Directions) — one per day with ≥ 2 places (trip path only).
- **Response shape:**
  - `{ type: "list", slug, ownerName, list, places }` (places ordered by `list_places.sort_order`).
  - `{ type: "trip", slug, ownerName, trip, days }` (each day with `places` + `route`).
- **Status:** `200`; `400` on unknown resource_type; `404` if link not found or `is_active = false`.
- **Side effects:** **Fire-and-forget** `view_count++` (the response doesn't wait for it).
- **Notes:** The viewer's `user_id` (or `auth.uid()`) is **never read** — the route is identical for anonymous and logged-in viewers. The "Save to my account" CTA on the page is purely client-side, gated on session presence.

### `POST /api/shared/[slug]/save`

- **Source:** `src/app/api/shared/[slug]/save/route.ts`
- **Auth:** required (the viewer must be signed in).
- **DB (cookie-scoped client):** `shared_links` SELECT (find target); then:
  - **List path:** read source `list_places` + `places`; insert new `lists` row for viewer; for each source place, check viewer's `places` by `google_place_id`, INSERT if missing; INSERT `list_places` with preserved sort_order.
  - **Trip path:** same as list but also creates a new `trips` row + `trip_days` rows; INSERTs `trip_day_places` referencing the viewer's place IDs.
- **External:** `parsePostgisPoint` for location transform.
- **Response:** `{ type, id: newResourceId }`. `200`, `401`, `404`.
- **Notes:** **Dedup by `google_place_id`** — if the viewer already has a place with that ID, reuses it; otherwise creates a new place row owned by the viewer. Places without `google_place_id` are always copied (no fingerprint to match on).

## Cross-route concerns

- **Service-role usage is scoped tight.** Only `GET /api/shared/[slug]` uses `createServiceClient()`. Every other shared-route uses the user-scoped client, which is correct because each operates on data the caller owns.
- **The save endpoint runs as the viewer.** New rows belong to `auth.uid()` of the request — the owner is **not** elevated. This is what makes the viral loop work.
- **No analytics beyond `view_count`.** No referrer, geo, or timestamp granularity captured. If sharing becomes a growth lever, an `interactions` table would unlock per-day fanout.

## Open questions

- **`view_count` race.** Concurrent reads can lose updates. Acceptable for vanity metric; switch to a stored proc if it becomes important.
- **Stale `resource_id`.** When a referenced list/trip is deleted, the share link silently becomes a 404. Either trigger-DELETE the share link or auto-disable it (see [[../schema/shared_links#open-questions]]).
- **Save deduplication aggressiveness.** Currently dedups only by `google_place_id`. A user could end up with duplicates if the source set has manual entries. Consider name + coords as a secondary key.
