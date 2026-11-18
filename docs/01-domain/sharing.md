---
title: Shared Link
type: entity
domain: sharing
version: 1.3.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/hooks/use-shared-links.ts
  - src/app/api/shared/route.ts
  - src/app/api/shared/[slug]/route.ts
  - src/app/api/shared/[slug]/save/route.ts
  - src/app/shared/[slug]/page.tsx
  - src/app/shared/layout.tsx
  - src/lib/supabase/server.ts
related:
  - "[[places]]"
  - "[[lists]]"
  - "[[plans]]"
  - "[[users-and-profiles]]"
  - "[[../02-backend/schema/shared_links]]"
  - "[[../02-backend/auth]]"
---

# Shared Link

> **v1.20.0 (NF-18):** `resource_type` widened to include `'place'` — single places are now shareable from the place detail header. The public place payload is a whitelist of rendered fields (no owner-personal data). Save-side fix: original content reads moved to the service client (owner-scoped RLS had blocked every cross-user save since April); re-sharing a deactivated resource reactivates the existing link.

> **v1.37.0:** trips became [[plans]]. A shared plan has `resource_type = 'plan'`; links created as `'trip'` keep working (plans kept the trips' ids) and are renamed at the cutover. The public plan payload is a whitelist — no budget (stop costs, currency, party size), no notes, no stop outcomes, no personal place fields. See [[../02-backend/api-routes/shared]].

A public, read-only slug URL pointing at one of the user's Lists, Plans, or single Places. The mechanism for sharing curated content without exposing the user's account. When viewed by a logged-in user, the page offers a "Save to my account" CTA that copies the resource into the viewer's data — the viral loop.

## Shape

### `shared_links`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. The creator/owner. |
| `resource_type` | text | yes | Check constraint: `'list'`, `'plan'`, `'place'` — and `'trip'` (the old name for plan) until the contract step. |
| `resource_id` | uuid | yes | Points at `lists.id`, `plans.id`, or `places.id` depending on `resource_type`. Not a FK (polymorphic by design). |
| `slug` | text | yes | **UNIQUE**. The path segment in `/shared/<slug>`. Generated via `nanoid(10)` server-side. |
| `is_active` | boolean | no | Default `true`. Toggle to disable a link without deleting it. |
| `view_count` | int | no | Default 0. Incremented on each public read. |
| `created_at` | timestamptz | no | `default now()`. |

### Indexes

- `shared_links_slug_key` (UNIQUE) — enforces slug uniqueness.
- `idx_shared_links_slug WHERE is_active = true` — partial index for the hot public-read path.

## Invariants

- **Slug is the public identity.** `id` never appears in URLs. Anyone with the slug can read (when `is_active = true`).
- **`resource_id` is not FK-constrained.** Because `resource_type` swings between `lists`, `plans`, and `places`, no single FK applies. The API checks ownership on create (`auth.uid()` must own the referenced row) but the DB itself doesn't enforce existence.
- **`is_active = false` returns 404**, not 410. The viewer experience: link looks dead, not "disabled".
- **`view_count` increment is best-effort.** Failures on the counter update don't block the read.
- **No expiry.** Links live forever until manually disabled or deleted.

## RLS posture

This is the only public-readable user-data table in the schema. Two policies on `shared_links`:

| Policy | Role | CMD | Predicate |
|---|---|---|---|
| `Anyone can read active shared links` | `public` | SELECT | `is_active = true` |
| `Users can manage own shared links` | `public` | ALL | `auth.uid() = user_id` |

(The "public" role on the second policy still requires `auth.uid()` to return a non-null UUID — anonymous users can't satisfy it. This is just how Supabase generates policies for "authenticated + anon" by default.)

The public read of the shared-links **row** doesn't grant access to the referenced list/plan rows. To resolve those, the API uses the **service-role client** (`createServiceClient` in `src/lib/supabase/server.ts`) which bypasses RLS. The endpoint then carefully selects only what's safe to expose.

## Lifecycle

```
   ┌─────────────────────────────────────────────────────────┐
   │  CREATE                                                  │
   │  • POST /api/shared { resource_type, resource_id }       │
   │  • Server verifies ownership of resource_id              │
   │  • Generates nanoid(10) slug                             │
   │  • INSERT into shared_links                              │
   │  • Returns slug                                          │
   └────────────────────┬────────────────────────────────────┘
                        │
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │  PUBLIC READ                                             │
   │  • /shared/<slug> — middleware exempt                    │
   │  • GET /api/shared/<slug> uses service-role client       │
   │  • Increments view_count                                 │
   │  • Returns list+places, a whitelisted plan (days, stops) │
   │    or a single whitelisted place                         │
   │  • Plan routes are computed via Mapbox per day           │
   └────────────────────┬────────────────────────────────────┘
                        │
                        ▼ (logged-in viewer)
   ┌─────────────────────────────────────────────────────────┐
   │  SAVE TO ACCOUNT (viral loop)                            │
   │  • POST /api/shared/<slug>/save                          │
   │  • Original content read via service client (v1.20.0     │
   │    fix); INSERTs run as the viewer (RLS WITH CHECK)      │
   │  • Copies places into viewer's account (duplicate-safe   │
   │    by google_place_id), source: 'shared'                 │
   │  • For plans, copies the places, then the plan with its  │
   │    days and stops in one transaction (create_plan);      │
   │    for place shares, a single-place copy                 │
   └────────────────────┬────────────────────────────────────┘
                        │
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DISABLE                                                 │
   │  • PATCH /api/shared (set is_active: false)              │
   │  • Slug now 404s; row preserved                          │
   └─────────────────────────────────────────────────────────┘
```

## Public read response shape

By resource type (assembled in `GET /api/shared/[slug]`):

**List:**
- `resource_type: "list"`
- `list: { id, name, description, color, place_count }`
- `places: Place[]` (ordered by `list_places.sort_order`)

**Plan (v1.37.0):**
- `type: "plan"`
- `plan: { id, name, start_date, end_date, status, day_count, stop_count, days }` — dates are `null` for a plan that isn't scheduled
- each day: `{ id, day_number, date, routing_profile, route, stops }`; `route` is `{ distance_km, duration_min, geometry, legs }` (Mapbox Directions per day, attributed to the link's owner)
- each stop: `{ id, title, start_time, day_part, place }`; `place` is `{ id, name, address, city, country, rating, location, category {name, color}, google_data {url} }` or `null` for a stop without a place
- **Not sent:** cost estimates, currency, party size, plan / day / stop notes, stop status, the place's visit status and the rest of its Google data

**Place (v1.20.0):**
- `type: "place"`
- `place` — a **whitelist** of what `SharedPlaceView` renders: `id, name, address, city, country, notes, category {name, color}, location {lat, lng}`, and `google_data` limited to `photo_storage_url, rating, user_ratings_total, opening_hours, website, url`. Owner-personal fields (user_id, rating, visit_status, booked_at/visited_at, source, timestamps) and heavy/private google_data (reviews, place_profile) never leave the server.

The owner's `user_id` is **not** included in the response.

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `shared_links.user_id` FK |
| [[lists\|List]] / [[plans\|Plan]] / [[places\|Place]] | N:1 (polymorphic) | `resource_id` + `resource_type` |

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/shared` | Authenticated | Create a slug link for a list/plan/place the user owns (reactivates a deactivated existing link). |
| `PATCH` | `/api/shared` | Authenticated | Toggle `is_active` or other flags (no UI call sites yet — v4 debt). |
| `GET` | `/api/shared/[slug]` | **Public** (uses service-role client) | Resolve slug → list/plan/place payload, increment view count. |
| `POST` | `/api/shared/[slug]/save` | Authenticated viewer | Copy the shared content into the viewer's account. |

The `/api/shared/*` paths are explicitly exempt in `src/lib/supabase/middleware.ts`:

```
const isPublicRoute =
  request.nextUrl.pathname === "/" ||
  request.nextUrl.pathname.startsWith("/auth/callback") ||
  request.nextUrl.pathname.startsWith("/shared/") ||
  request.nextUrl.pathname.startsWith("/api/shared/");
```

## Frontend code surface

- **Hook:** `src/lib/hooks/use-shared-links.ts` — `useSharedLink()`, `useCreateSharedLink()`, `useToggleSharedLink()`, `useSaveSharedContent()` (resource_type unions include `"place"` as of v1.20.0).
- **Page:** `src/app/shared/[slug]/page.tsx` — standalone layout (no app sidebar/header) with Save CTA; renders `SharedListView` / `SharedPlanView` / `SharedPlaceView`. Layout file: `src/app/shared/layout.tsx`.
- **Entry points:** list detail page, the plan menu ("Copy share link") and the place detail header Share2 button (v1.20.0).

## Security notes

- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is the **only** secret that lets a request bypass RLS. It MUST stay server-side. Its absence from `.env.local.example` is a known gap — see [[../06-ops/env-vars]] when written.
- The viewer never sees the owner's `user_id`, email, or other profile fields.
- The "save to account" endpoint runs as the **viewer**, not the owner — the copied rows belong to the viewer.
- Disabling a link is reversible (toggle back). Deleting it is not. UI exposes only disable to limit blast radius.

## Open questions

- **View count integrity.** If two parallel requests race the increment, the counter can lag. Not currently an issue, but if it becomes a vanity metric users see, a stored-proc would be safer than a read-modify-write.
- **No analytics fanout.** `view_count` is the only signal we keep. No per-day, per-referrer, or geo-IP breakdown. Worth weighing if the share feature becomes a growth lever.
