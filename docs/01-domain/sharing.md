---
title: Shared Link
type: entity
domain: sharing
version: 1.0.0
last_updated: 12.05.2026
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
  - "[[trips]]"
  - "[[users-and-profiles]]"
  - "[[../02-backend/schema/shared_links]]"
  - "[[../02-backend/auth]]"
---

# Shared Link

A public, read-only slug URL pointing at one of the user's Lists or Trips. The mechanism for sharing curated content without exposing the user's account. When viewed by a logged-in user, the page offers a "Save to my account" CTA that copies the resource into the viewer's data — the viral loop.

## Shape

### `shared_links`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. The creator/owner. |
| `resource_type` | text | yes | Check constraint: `'list'` or `'trip'`. |
| `resource_id` | uuid | yes | Points at `lists.id` or `trips.id` depending on `resource_type`. Not a FK (polymorphic by design). |
| `slug` | text | yes | **UNIQUE**. The path segment in `/shared/<slug>`. Generated via `nanoid(10)` server-side. |
| `is_active` | boolean | no | Default `true`. Toggle to disable a link without deleting it. |
| `view_count` | int | no | Default 0. Incremented on each public read. |
| `created_at` | timestamptz | no | `default now()`. |

### Indexes

- `shared_links_slug_key` (UNIQUE) — enforces slug uniqueness.
- `idx_shared_links_slug WHERE is_active = true` — partial index for the hot public-read path.

## Invariants

- **Slug is the public identity.** `id` never appears in URLs. Anyone with the slug can read (when `is_active = true`).
- **`resource_id` is not FK-constrained.** Because `resource_type` swings between `lists` and `trips`, no single FK applies. The API checks ownership on create (`auth.uid()` must own the referenced row) but the DB itself doesn't enforce existence.
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

The public read of the shared-links **row** doesn't grant access to the referenced list/trip rows. To resolve those, the API uses the **service-role client** (`createServiceClient` in `src/lib/supabase/server.ts`) which bypasses RLS. The endpoint then carefully selects only what's safe to expose.

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
   │  • Returns either list+places or trip+days+places        │
   │  • Trip routes are computed via Mapbox per day           │
   └────────────────────┬────────────────────────────────────┘
                        │
                        ▼ (logged-in viewer)
   ┌─────────────────────────────────────────────────────────┐
   │  SAVE TO ACCOUNT (viral loop)                            │
   │  • POST /api/shared/<slug>/save                          │
   │  • Copies places into viewer's account (duplicate-safe   │
   │    by google_place_id or name+coords)                    │
   │  • For trips, copies trip + days + day_places too        │
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

**Trip:**
- `resource_type: "trip"`
- `trip: { id, name, start_date, end_date, color, notes, day_count, place_count }`
- `days: TripDay[]` — each with `places: TripDayPlace[]` and `route: { distance_km, duration_min, geometry, legs }` (Mapbox Directions per day)

The owner's `user_id` is **not** included in the response.

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `shared_links.user_id` FK |
| [[lists\|List]] / [[trips\|Trip]] | N:1 (polymorphic) | `resource_id` + `resource_type` |

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/shared` | Authenticated | Create a slug link for a list or trip the user owns. |
| `PATCH` | `/api/shared` | Authenticated | Toggle `is_active` or other flags. |
| `GET` | `/api/shared/[slug]` | **Public** (uses service-role client) | Resolve slug → list/trip payload, increment view count. |
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

- **Hook:** `src/lib/hooks/use-shared-links.ts` — `useSharedLinks()`, `useCreateShare()`, `useToggleShare()`.
- **Page:** `src/app/shared/[slug]/page.tsx` — standalone layout (no app sidebar/header) with Save CTA. Layout file: `src/app/shared/layout.tsx`.

## Security notes

- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is the **only** secret that lets a request bypass RLS. It MUST stay server-side. Its absence from `.env.local.example` is a known gap — see [[../06-ops/env-vars]] when written.
- The viewer never sees the owner's `user_id`, email, or other profile fields.
- The "save to account" endpoint runs as the **viewer**, not the owner — the copied rows belong to the viewer.
- Disabling a link is reversible (toggle back). Deleting it is not. UI exposes only disable to limit blast radius.

## Open questions

- **View count integrity.** If two parallel requests race the increment, the counter can lag. Not currently an issue, but if it becomes a vanity metric users see, a stored-proc would be safer than a read-modify-write.
- **No analytics fanout.** `view_count` is the only signal we keep. No per-day, per-referrer, or geo-IP breakdown. Worth weighing if the share feature becomes a growth lever.
