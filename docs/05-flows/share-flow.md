---
title: Share Flow
type: flow
domain: sharing
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/shared/route.ts
  - src/app/api/shared/[slug]/route.ts
  - src/app/api/shared/[slug]/save/route.ts
  - src/app/shared/[slug]/page.tsx
  - src/lib/hooks/use-shared-links.ts
related:
  - "[[../01-domain/sharing]]"
  - "[[../02-backend/api-routes/shared]]"
  - "[[../02-backend/schema/shared_links]]"
---

# Share Flow

End-to-end public sharing of a list or trip — from creating the slug to a logged-in viewer saving the content into their own account.

## Trigger

Owner clicks "Share" on a list or trip detail page.

## Steps

```
1. Owner clicks "Share"
       │
       ▼
2. useCreateSharedLink → POST /api/shared { resource_type, resource_id }
       │  • Verifies user owns lists.id or trips.id
       │  • Returns existing link if (user_id, resource_type, resource_id)
       │    already shared — idempotent
       │  • Else: nanoid(10) slug + INSERT shared_links
       │  • Returns the link (with slug)
       │
       ▼
3. UI shows public URL: https://<host>/shared/<slug>
       │  • Copy-to-clipboard button
       │  • Toggle to disable later (PATCH /api/shared { id, is_active: false })
       │
       ▼ (some time later)
4. Viewer (anonymous OR authenticated) opens /shared/<slug>
       │  • Middleware bypasses auth for /shared/*
       │  • shared/layout.tsx provides standalone layout
       │
       ▼
5. GET /api/shared/<slug>
       │  • Uses createServiceClient() (RLS bypass)
       │  • SELECT shared_links WHERE slug AND is_active = true
       │      If not found: 404
       │  • UPDATE view_count++ (fire-and-forget)
       │  • SELECT profiles to get ownerName
       │  • Branch by resource_type:
       │      — list: SELECT lists, list_places, places + categories
       │      — trip: SELECT trip, trip_days, trip_day_places, places + categories
       │              + Mapbox getRoute per multi-stop day
       │  • Returns assembled payload (no owner user_id leaked)
       │
       ▼
6. Public page renders:
       │  • List: place cards + map view
       │  • Trip: day timeline + day-colored polylines on map
       │
       ▼ (if viewer is authenticated)
7. "Save to my account" CTA appears
       │
       ▼ Viewer clicks Save
8. useSaveSharedContent → POST /api/shared/<slug>/save
       │  • Cookie-scoped client (viewer's session)
       │  • Resolve slug → list or trip data (via service-role join, careful what's exposed)
       │  • Branch by type:
       │      — list:
       │          • INSERT new lists row owned by viewer (copy name, color, description)
       │          • For each source place:
       │              if viewer already has it (by google_place_id) → reuse
       │              else → INSERT new places row owned by viewer
       │          • INSERT list_places rows preserving sort_order
       │      — trip:
       │          • INSERT new trips row owned by viewer
       │          • INSERT trip_days rows (date offset preserved)
       │          • INSERT trip_day_places rows referencing viewer's place IDs
       │          • INSERT new places as needed (same dedup as above)
       │  • Returns { type, id: newResourceId }
       │
       ▼  Invalidates ["lists"], ["trips"], ["places"]
9. Toast: "Saved!" — viewer navigates to their new list/trip.
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | resource_type + resource_id | shared_links row (new or existing) |
| 5 | slug | assembled public payload + view_count++ |
| 8 | slug (viewer authenticated) | new list/trip + (maybe) new places for the viewer |

## Owner controls

| Action | Endpoint | Effect |
|---|---|---|
| Create / reuse share | `POST /api/shared` | Returns slug |
| Disable | `PATCH /api/shared { id, is_active: false }` | `/shared/<slug>` now 404s |
| Re-enable | `PATCH /api/shared { id, is_active: true }` | Public read works again |
| Hard delete | Direct Supabase delete (no API yet) | Slug is gone forever |

## Anonymous vs authenticated viewer

Same payload either way (step 5). The **Save** action requires auth — anonymous viewers see a "Sign in to save" CTA instead.

## Failure modes

- **Owner not authorized to share (step 2):** the API verifies `lists.user_id = auth.uid()`. Returns 404 if not owned (not 403 — don't leak existence).
- **Slug doesn't exist or disabled (step 5):** 404.
- **Underlying list/trip deleted (step 5):** the join returns null; the route returns 400/404. The share link survives in `shared_links` (orphaned).
- **Save while offline (step 8):** fails outright. UI shows a toast.
- **Race on view_count (step 5):** lost increments. Acceptable.

## Privacy notes

- The owner's `user_id`, email, and other profile fields are **not** in the response. Only `full_name` (as `ownerName`).
- Save inserts new rows owned by the viewer — the owner's data is unchanged.
- If the user disables the link, anyone with a cached URL gets 404 — but server logs may still show the access attempt.

## Related code

- `src/components/places/place-card.tsx` (and similar trip card) — share button entry points.
- `src/lib/hooks/use-shared-links.ts` — hooks.
- `src/app/api/shared/route.ts` — create/patch.
- `src/app/api/shared/[slug]/route.ts` — public read (service-role).
- `src/app/api/shared/[slug]/save/route.ts` — viewer save.
- `src/app/shared/[slug]/page.tsx` — public page UI.
- `src/app/shared/layout.tsx` — standalone layout.
- `src/lib/supabase/server.ts#createServiceClient` — the RLS-bypassing client.

## Open questions

- **Orphan share links.** If a list/trip is deleted, the share row sticks around and returns 4xx. Trigger to cascade-delete (or auto-disable) would be cleaner. See [[../02-backend/schema/shared_links#open-questions]].
- **Save dedup.** Places without `google_place_id` (manual entries) always get copied. A secondary fingerprint (name + nearest-100m coords) would reduce duplicates.
