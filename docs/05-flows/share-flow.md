---
title: Share Flow
type: flow
domain: sharing
version: 1.5.0
last_updated: 18.11.2026
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

> **v1.20.0 (NF-18):** tek mekan paylaşımı eklendi — detay sayfası başlığında Share2 butonu → link → `/shared/[slug]` `SharedPlaceView` (public payload WHITELIST: foto, kategori, rating, adres, saatler, harita pini, not — owner alanları ve review/AI profili sızmaz). "Save to my places" → tek mekan kopyası. İki düzeltme: save route orijinal içeriği artık service client'la okuyor (owner-scoped RLS her cross-user save'i Nisan'dan beri 404'lüyordu) ve deaktive edilmiş kaynağı yeniden paylaşmak mevcut linki reaktive ediyor.

End-to-end public sharing of a list, plan, or single place — from creating the slug to a logged-in viewer saving the content into their own account.

## Trigger

Owner clicks "Share" on a list or place detail page, or "Copy share link" in a plan's menu.

## Steps

```
1. Owner clicks "Share"
       │
       ▼
2. useCreateSharedLink → POST /api/shared { resource_type, resource_id }
       │  • Verifies user owns lists.id, plans.id, or places.id
       │  • Returns existing link if (user_id, resource_type, resource_id)
       │    already shared — idempotent; if that link was deactivated,
       │    flips is_active back to true (v1.20.0) so the URL works
       │  • Else: nanoid(10) slug + INSERT shared_links
       │  • Returns the link (with slug)
       │
       ▼
3. UI shows public URL: https://<host>/shared/<slug>
       │  • Copy-to-clipboard button
       │  • Disable = PATCH /api/shared { id, is_active: false }
       │    (API only — no UI calls it yet; v4 debt)
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
       │      — list: SELECT lists, list_places (with note), places +
       │        categories — all scoped to the link's owner (v1.40.0)
       │      — plan (also links stored as "trip"): getPlan, scoped by the
       │              owner's id — plan, days, stops, light places in one query
       │              + withRoutes: Mapbox per day with ≥ 2 located stops, the
       │                day's routing_profile — tracked as mapbox_directions
       │                attributed to the link OWNER (their share, their quota)
       │              payload is a WHITELIST (handlePlanShare): no costs,
       │                currency, party size, notes, stop status, visit status
       │      — place (v1.20.0): SELECT single place + categories(name, color)
       │              payload is a WHITELIST of rendered fields only
       │              (no user_id / rating / visit_status / dates / source;
       │               google_data limited to photo, rating, hours, website, url)
       │  • Returns assembled payload (no owner user_id leaked)
       │
       ▼
6. Public page renders:
       │  • List: place cards + map view
       │  • Plan: dates (when set), day timeline with times and free-text
       │    stops, day-colored polylines on map
       │  • Place: SharedPlaceView — photo, category chip, rating, address,
       │    notes, map pin, opening hours, website/maps links
       │
       ▼ (if viewer is authenticated)
7. "Save to my account" CTA appears
       │
       ▼ Viewer clicks Save
8. useSaveSharedContent → POST /api/shared/<slug>/save
       │  • Link lookup: cookie client (public-read policy covers active links)
       │  • ORIGINAL content reads: createServiceClient() — v1.20.0 fix;
       │    owner-scoped RLS had 404'd every cross-user save since April
       │  • All INSERTs: cookie client (RLS WITH CHECK enforces user_id)
       │  • Branch by type:
       │      — list (v1.40.0):
       │          • For each source place (copyPlaceFor):
       │              if viewer already has it (by google_place_id) → reuse
       │              else → INSERT new places row owned by viewer
       │                     (source: 'shared', with the owner's place note)
       │          • createList → save_list: the list (name, colour,
       │            description) with its places in order and their
       │            list notes, one transaction; a place that couldn't
       │            be copied is left out
       │      — plan:
       │          • copy each place for the viewer (same dedup as above)
       │          • createPlan → create_plan: the plan, its days and stops
       │            in ONE transaction (name, start date, order, times,
       │            free-text stops; not costs, notes or party size)
       │      — place (v1.20.0):
       │          • Single-place copy — same dedupe by google_place_id;
       │            omits rating/visit_status/category; source: 'shared'
       │  • Returns { type, id: newResourceId }
       │
       ▼  Invalidates ["lists"], ["plans"], ["places"]
9. Toast: "Saved!" — viewer navigates to their new list/plan/place.
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | resource_type + resource_id | shared_links row (new or existing) |
| 5 | slug | assembled public payload + view_count++ |
| 8 | slug (viewer authenticated) | new list/plan + (maybe) new places for the viewer |

## Owner controls

| Action | Endpoint | Effect |
|---|---|---|
| Create / reuse share | `POST /api/shared` | Returns slug |
| Disable | `PATCH /api/shared { id, is_active: false }` | `/shared/<slug>` now 404s — **API only, no UI yet (v4 debt)** |
| Re-enable | `PATCH /api/shared { id, is_active: true }` — or simply Share again (auto-reactivates, v1.20.0) | Public read works again |
| Hard delete | Direct Supabase delete (no API yet) | Slug is gone forever |

## Anonymous vs authenticated viewer

Same payload either way (step 5). The **Save** action requires auth — anonymous viewers see a "Sign in to save" CTA instead.

## Failure modes

- **Owner not authorized to share (step 2):** the API verifies `lists.user_id = auth.uid()`. Returns 404 if not owned (not 403 — don't leak existence).
- **Slug doesn't exist or disabled (step 5):** 404.
- **Underlying list/plan deleted (step 5):** the join returns null; the route returns 400/404. The share link survives in `shared_links` (orphaned).
- **Save while offline (step 8):** fails outright. UI shows a toast.
- **Race on view_count (step 5):** lost increments. Acceptable.

## Privacy notes

- The owner's `user_id`, email, and other profile fields are **not** in the response. Only `full_name` (as `ownerName`).
- Trip budget data is owner-private (v1.22.0): `cost_estimate`/`currency` per stop and `party_size` are stripped from the public trip payload.
- Save inserts new rows owned by the viewer — the owner's data is unchanged.
- If the user disables the link, anyone with a cached URL gets 404 — but server logs may still show the access attempt.

## Related code

- `src/components/places/place-card.tsx` — share button entry point; for plans: `src/components/plans/plan-menu.tsx`.
- `src/app/(app)/places/[id]/page.tsx` — place detail Share2 button (v1.20.0).
- `src/lib/hooks/use-shared-links.ts` — hooks.
- `src/app/api/shared/route.ts` — create/patch.
- `src/app/api/shared/[slug]/route.ts` — public read (service-role).
- `src/app/api/shared/[slug]/save/route.ts` — viewer save.
- `src/app/shared/[slug]/page.tsx` — public page UI.
- `src/app/shared/layout.tsx` — standalone layout.
- `src/lib/supabase/server.ts#createServiceClient` — the RLS-bypassing client.

## Open questions

- **Orphan share links.** If a list/plan is deleted, the share row sticks around and returns 4xx. Trigger to cascade-delete (or auto-disable) would be cleaner. See [[../02-backend/schema/shared_links#open-questions]].
- **Save dedup.** Places without `google_place_id` (manual entries) always get copied. A secondary fingerprint (name + nearest-100m coords) would reduce duplicates.
