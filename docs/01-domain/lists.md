---
title: List
type: entity
domain: lists
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/hooks/use-lists.ts
  - src/app/api/lists/[id]/reorder/route.ts
  - src/app/(app)/lists/page.tsx
  - src/app/(app)/lists/[id]/page.tsx
related:
  - "[[places]]"
  - "[[trips]]"
  - "[[sharing]]"
  - "[[../02-backend/schema/lists]]"
  - "[[../02-backend/schema/list_places]]"
---

# List

A named, ordered grouping of Places. The simplest organizational unit besides a Category — a "Tokyo Coffee Tour", a "Wishlist", a "Visited in 2025". Lists are M:N with Places via the `list_places` junction, which carries the ordering.

A List can also seed a Trip (the trip copies the list's places into its days).

## Shape

### `lists`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. RLS-scoped. |
| `name` | text | yes | — |
| `description` | text | no | Free-form. |
| `color` | text | no | Hex like `'#059669'`. Default emerald. Used for list pills and map markers when a single list is filtered. |
| `created_at` | timestamptz | yes | `default now()`. |
| `updated_at` | timestamptz | yes | `default now()`. |

### `list_places` (junction)

| Field | Type | Required | Notes |
|---|---|---|---|
| `list_id` | uuid | yes | FK → `lists.id`. |
| `place_id` | uuid | yes | FK → `places.id`. |
| `sort_order` | int | no | Within-list order. Default 0. |
| `added_at` | timestamptz | no | `default now()`. |

**Primary key:** `(list_id, place_id)` composite. A place can be in many lists; a list-place pair is unique.

### Joined type (`PlaceList` interface)

`PlaceList` in `src/lib/types/index.ts` adds:

- `place_count?: number` — count of joined `list_places` rows. Set by the list hook for badge rendering.

## Invariants

- **Uniqueness.** A place can be in a given list at most once (enforced by PK).
- **Sort order is dense and 0-based** (set by the reorder endpoint). New places are appended at `MAX(sort_order) + 1` when added one at a time.
- **Reordering is bulk-replace.** `PATCH /api/lists/[id]/reorder` accepts a full ordered array of place IDs and rewrites every `sort_order` in one transaction.
- **Filter behavior.** `GET /api/places?list_id=...` returns places joined with the list, ordered by `list_places.sort_order` ascending.
- **Color is presentational only.** Doesn't drive any logic — just shown in the UI.

## Lifecycle

```
   ┌─────────────────────────────────────────────────┐
   │  CREATE list                                     │
   │  • via /lists page or inline-list-creator        │
   │  • PATCH lists name/description/color afterwards │
   └────────────────┬────────────────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────────────────┐
   │  ADD places                                      │
   │  • Single: inline-list-creator from place card   │
   │  • Bulk: BulkActionBar "Add to list"             │
   │  • Each insert: INSERT list_places with          │
   │    sort_order = MAX(sort_order) + 1              │
   └────────────────┬────────────────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────────────────┐
   │  REORDER                                         │
   │  • List detail page drag-and-drop (@dnd-kit)     │
   │  • Optimistic update via useReorderListPlaces    │
   │  • PATCH /api/lists/[id]/reorder { place_ids[] } │
   │  • Server rewrites every list_places.sort_order  │
   └────────────────┬────────────────────────────────┘
                    │
                    ▼ optional
   ┌─────────────────────────────────────────────────┐
   │  SHARE                                           │
   │  • POST /api/shared { resource_type: "list" }    │
   │  • Returns slug; /shared/<slug> renders publicly │
   └────────────────┬────────────────────────────────┘
                    │
                    ▼ optional
   ┌─────────────────────────────────────────────────┐
   │  SEED A TRIP                                     │
   │  • POST /api/trips with list_id                  │
   │  • Trip materializes a day per date, then either │
   │    copies all list places to day 1 or runs       │
   │    auto-plan to spread them across days          │
   └─────────────────────────────────────────────────┘
```

## Relationships

| Entity | Cardinality | Mechanism |
|---|---|---|
| [[users-and-profiles\|User]] | N:1 | `lists.user_id` FK |
| [[places\|Place]] | M:N | `list_places` junction with `sort_order` |
| [[trips\|Trip]] | 1:N (optional) | `trips.list_id` FK |
| [[sharing\|Shared Link]] | 0..N | `shared_links.resource_type = 'list'`, `resource_id = lists.id` |

When a list is deleted:

- `list_places` rows cascade away.
- Any `trips.list_id` pointing at it becomes orphaned (FK is nullable; the trip continues to exist, just without a back-link).

## API surface

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/lists/[id]/reorder` | Replace `sort_order` for every list-place pair. |

Note: standard CRUD for lists themselves (create/update/delete) is done via direct Supabase calls from the frontend (no dedicated API route observed). This is consistent with the RLS-as-API pattern — `useLists` and friends hit Supabase JS client directly. The reorder endpoint exists because it needs a transaction.

## Frontend code surface

- **Hooks:** `src/lib/hooks/use-lists.ts` — `useLists()`, `useList(id)`, mutations for create/update/delete/reorder. Query keys `["lists"]` and `["list", id]`.
- **Pages:**
  - `src/app/(app)/lists/page.tsx` — Lists + Trips tabbed view.
  - `src/app/(app)/lists/[id]/page.tsx` — list detail with drag-and-drop place reorder.
- **Inline creator:** `src/components/places/inline-list-creator.tsx` — used inside place cards and dialogs.
- **Filter:** `src/components/filters/list-filter.tsx` — single-select list pill in the filter UI.

## Open questions

- **Bulk reorder transactionality.** The reorder endpoint rewrites every row — confirm it runs in a single transaction so partial failures don't leave the list in a half-reordered state.
- **List capacity.** No documented limit. With 95 `list_places` rows across 6 lists currently, performance is fine, but a very large list could be worth paginating in the detail view.
