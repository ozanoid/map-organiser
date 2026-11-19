---
title: Shared routes
type: route-group
domain: backend
version: 1.5.2
last_updated: 19.11.2026
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

> **v1.20.0 (NF-18):** all three routes gained a `place` branch — create validates `resource_type` ∈ list|trip|place (ownership via the places table); public read returns `{type:'place', place}` as a **whitelist** of rendered fields only; save copies the single place with `source:'shared'` + google_place_id dedupe. Two fixes shipped alongside: the save route now reads ORIGINAL content with the service client (owner-scoped RLS had 404'd every cross-user save since April), and re-sharing a deactivated resource reactivates the existing link instead of returning a dead URL.

> **v1.40.0:** the public read of a place and of a list (with its places), and the save of a shared place, are scoped to the link's owner (`user_id = link.user_id`): `shared_links` rows are the user's own, but nothing stops a signed-in user from writing one with someone else's resource id, and the service client used to hand that resource out — the plan branch was already scoped (`getPlan` with the owner's id). A list's places carry `list_note`, the owner's note on the place in that list (Ozan's decision); saving a shared list copies its places (an existing one with the same Google id is reused; a copy keeps the owner's note on the place, which the public view shows), then creates the list with its order and list notes in one `save_list` transaction. A place that couldn't be copied is left out — before, the owner's place id was put on the visitor's list.

> **v1.37.0:** the trip branch became the **plan** branch on all three routes. Create takes `resource_type: "plan"` (it still accepts `"trip"` from a page loaded before the rename) and returns the plan's existing link whether it was stored as `plan` or `trip`; the public read builds a whitelisted payload from `getPlan` + `withRoutes`; save copies the places and then creates the plan in one transaction (`create_plan`). Links stored as `trip` keep resolving — plans kept the trips' ids.

Three route handlers for the public-sharing surface. **This is the only group with a public-facing endpoint** — `GET /api/shared/[slug]` uses the service-role client to bypass RLS.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/shared` | required | Create (or return existing, reactivating if disabled) share link for a list/plan/place the user owns. |
| `PATCH` | `/api/shared` | required | Toggle `is_active` on a share link. |
| `GET` | `/api/shared/[slug]` | **PUBLIC** (service role) | Resolve slug → payload. Increment view count. |
| `POST` | `/api/shared/[slug]/save` | required (viewer) | Copy the shared resource into the viewer's account. |

The `/api/shared/*` prefix is explicitly exempt from the auth-required middleware gate (`src/lib/supabase/middleware.ts`).

---

## Per-route detail

### `POST /api/shared`

- **Source:** `src/app/api/shared/route.ts`
- **Auth:** required.
- **Body:** `{ resource_type: "list"|"plan"|"place", resource_id: uuid }` (zod; `"trip"` is accepted and treated as `"plan"`).
- **DB:** ownership check on `lists.id`, `plans.id`, or `places.id`; `shared_links` SELECT (existing — for a plan, a row of type `plan` **or** `trip`, oldest first) + INSERT (new) or UPDATE (reactivate).
- **External:** `nanoid(10)` for slug.
- **Response:** Returns existing or new share link `{ id, slug, ... }`. `200`, `400` on bad resource_type, `404` if resource not owned.
- **Notes:** **Idempotent** — returns the existing link if `(user_id, resource_type, resource_id)` is already shared. No duplicates. If the existing link was deactivated via PATCH, sharing again flips `is_active` back to `true` (v1.20.0) — the returned URL always works.

### `PATCH /api/shared`

- **Source:** `src/app/api/shared/route.ts`
- **Auth:** required.
- **Body:** `{ id: uuid, is_active: boolean }`.
- **DB:** `shared_links` UPDATE.
- **Response:** Updated link.
- **Notes:** Disabling sets `is_active = false`. The link's slug now 404s (or rather: the public read returns 404 because the partial index `idx_shared_links_slug WHERE is_active = true` won't match). **No UI calls this yet** — `useToggleSharedLink` exists but has zero call sites (tracked as debt in the v4 plan).

### `GET /api/shared/[slug]`

- **Source:** `src/app/api/shared/[slug]/route.ts`
- **Auth:** **PUBLIC** — uses `createServiceClient()` to bypass RLS.
- **DB (service role):** `shared_links` SELECT + UPDATE (view_count++); `profiles` SELECT (owner name); then either:
  - **List path:** `lists` SELECT + `list_places` SELECT (`place_id, sort_order, note`) + `places` SELECT joined with `categories` — the list and the places scoped to `link.user_id`.
  - **Plan path (types `plan` and `trip`):** `getPlan({ supabase: service, userId: link.user_id }, link.resource_id)` — one query, scoped by the owner's id.
  - **Place path (v1.20.0):** single `places` SELECT joined with `categories(name, color)`.
- **External:** `withRoutes(plan)` → Mapbox Directions, one per day with ≥ 2 located stops (plan path only), with the day's `routing_profile`, tracked as `mapbox_directions` against the link owner.
- **Response shape:**
  - `{ type: "list", slug, ownerName, list, places }` (places ordered by `list_places.sort_order`, each with `list_note`). `list` is `{ id, name, description, color }` — what SharedListView renders (v1.43.0; before, the full row went out, the owner's `user_id` with it).
  - `{ type: "plan", slug, ownerName, plan }` — a **whitelist** (`handlePlanShare`): `plan { id, name, start_date, end_date, status, day_count, stop_count, days }`; day `{ id, day_number, date, routing_profile, route, stops }`; stop `{ id, title, start_time, day_part, place }`; place `{ id, name, address, city, country, rating, location, category {name, color}, google_data {url} }`. **Not sent:** cost estimates, currency, party size, notes (plan, day, stop), stop status, the place's visit status and the rest of its Google data. Checked on 18.11.2026 against a real 19-stop plan: 48 KB (mostly route geometry), none of those keys in the payload.
  - `{ type: "place", slug, ownerName, place }` — place is a **whitelist**: `id, name, address, city, country, notes, category {name, color}, location {lat, lng}`, and `google_data` limited to `photo_storage_url, rating, user_ratings_total, opening_hours, website, url`. Owner-personal fields (user_id, rating, visit_status, booked_at/visited_at, source, timestamps) and heavy/private google_data (reviews, place_profile, work_timetable, attributes, topics) never leave the server.
- **Status:** `200`; `400` on unknown resource_type; `404` if link not found or `is_active = false`.
- **Side effects:** **Fire-and-forget** `view_count++` (the response doesn't wait for it).
- **Notes:** The viewer's `user_id` (or `auth.uid()`) is **never read** — the route is identical for anonymous and logged-in viewers. The "Save to my account" CTA on the page is purely client-side, gated on session presence.

### `POST /api/shared/[slug]/save`

- **Source:** `src/app/api/shared/[slug]/save/route.ts`
- **Auth:** required (the viewer must be signed in).
- **DB — two clients (v1.20.0 fix):** the link lookup runs on the cookie client (public-read policy covers `is_active = true` rows), **reads of the ORIGINAL content run on `createServiceClient()`** (lists/plans/places have owner-scoped RLS only — the cookie client 404'd every cross-user save since April), and **all INSERTs stay on the cookie client** so RLS WITH CHECK enforces `user_id` ownership. Paths:
  - **List path:** read the source list with its items (`getList` with the owner's id, service client) and its places; copy each place for the viewer (`copyPlaceFor`, shared with the plan path — reuse by `google_place_id`, else INSERT with the owner's place note); then `createList` for the viewer with `add_place` ops in the list's order, each with its list note — one `save_list` transaction (v1.40.0).
  - **Plan path:** read the plan with `getPlan` (service, scoped by the owner's id) and its places' full rows; copy each place for the viewer (`copyPlaceFor`: reuse by `google_place_id`, else INSERT with `source: 'shared'`); then `createPlan` with the viewer's client — the plan, its days and stops in one transaction. Copied: name, start date, colour, the order of the stops, their times, free-text stops. Not copied: costs, notes, party size. A place that could not be copied is left out of the new plan.
  - **Place path (v1.20.0):** read the single source place (service); dedupe by `google_place_id`; INSERT with `source: 'shared'`, omitting rating/visit_status/category (categories are per-user).
- **External:** `parsePostgisPoint` for location transform.
- **Response:** `{ type, id: newResourceId }` (place path adds `deduped: true` when reused). `200`, `401`, `404`.
- **Notes:** **Dedup by `google_place_id`** — if the viewer already has a place with that ID, reuses it; otherwise creates a new place row owned by the viewer. Places without `google_place_id` are always copied (no fingerprint to match on). A concurrent double-tap that passes the check twice is refused by `places_user_google_place_id_key` (v1.41.0) and answered with the existing place (`deduped: true`; the list copy reuses it too) — before, it could duplicate.

## Cross-route concerns

- **Service-role usage is scoped tight.** `GET /api/shared/[slug]` runs fully on `createServiceClient()`; `POST /api/shared/[slug]/save` uses it ONLY for reading the shared originals — writes go through the viewer's cookie client. Every other shared-route call is user-scoped.
- **The save endpoint runs as the viewer.** New rows belong to `auth.uid()` of the request — the owner is **not** elevated. This is what makes the viral loop work.
- **No analytics beyond `view_count`.** No referrer, geo, or timestamp granularity captured. If sharing becomes a growth lever, an `interactions` table would unlock per-day fanout.

## Open questions

- **`view_count` race.** Concurrent reads can lose updates. Acceptable for vanity metric; switch to a stored proc if it becomes important.
- **Stale `resource_id`.** When a referenced list/plan/place is deleted, the share link silently becomes a 404. Either trigger-DELETE the share link or auto-disable it (see [[../schema/shared_links#open-questions]]).
- **Save deduplication aggressiveness.** Currently dedups only by `google_place_id`. A user could end up with duplicates if the source set has manual entries. Consider name + coords as a secondary key.
- **No revocation UI.** PATCH exists but nothing renders a toggle; deactivation is currently only possible via direct API call. Debt row in the v4 plan.
