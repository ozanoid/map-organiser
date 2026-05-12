---
title: Places components
type: component
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/components/places/add-place-dialog.tsx
  - src/components/places/bulk-action-bar.tsx
  - src/components/places/inline-category-creator.tsx
  - src/components/places/inline-list-creator.tsx
  - src/components/places/inline-tag-input.tsx
  - src/components/places/place-card.tsx
  - src/components/places/visit-status-toggle.tsx
related:
  - "[[_README]]"
  - "[[../hooks/use-places]]"
  - "[[../hooks/use-categories]]"
  - "[[../hooks/use-tags]]"
  - "[[../hooks/use-lists]]"
  - "[[../../01-domain/places]]"
---

# Places components

Seven files under `src/components/places/`. All `"use client"`. The Place-related UI surface.

## `AddPlaceDialog`

- **File:** `src/components/places/add-place-dialog.tsx`
- **Props:** `{ open, onOpenChange, initialUrl? }`.
- **Hooks:** `useState`, `useEffect`, `useQueryClient`, [[../hooks/use-places|`useParseLink`/`useCreatePlace`]], [[../hooks/use-categories|`useCategories`]], [[../hooks/use-lists|`useLists`]].
- **API calls:**
  - `useParseLink` mutation (`POST /api/places/parse-link`).
  - `useCreatePlace` mutation (`POST /api/places`).
  - `POST /api/places/[id]/enrich?step=info` (awaited after save).
  - `POST /api/places/[id]/enrich?step=reviews` (fire-and-forget).
- **State:** input URL, parsed place data, provider info, category id, notes, rating, selected list/tag ids, visit status (default `want_to_go`).
- **Composes:** `InlineCategoryCreator`, `InlineListCreator`, `InlineTagInput` (all from this folder). shadcn `Dialog`, `Input`, `Textarea`, `Badge`, `Skeleton`, `Button`.
- **Flow:**
  1. Paste a Google Maps URL.
  2. `useParseLink` runs → preview card shows photo/rating/hours/etc.
  3. User picks category, lists, tags, visit status, optional rating + notes.
  4. `useCreatePlace` runs → place is saved.
  5. Two-phase enrichment after save: `info` (await) → `reviews` (fire-and-forget).
- **Used by:** `AppHeader` (Add Place button), `MapContent` (FAB + share-target intake).
- **Notes:** Auto-resolves category from Google `types` via `resolveCategoryId`. Displays which provider served the parse (Google vs DataForSEO) + fetch time. Sticky action buttons at the bottom.

## `BulkActionBar`

- **File:** `src/components/places/bulk-action-bar.tsx`
- **Props:** `{ selectedIds: Set<string>; onClear: () => void; onComplete: () => void }`.
- **Hooks:** `useState`, `useQueryClient`, `useCategories`, `useTags`, `useLists`.
- **API call:** `POST /api/places/bulk` with action and payload.
- **State:** `loading` (mutation in-flight).
- **Renders:** fixed bottom bar — selection count + clear, four action dropdowns (Category, Tag, List, Status), and a delete button.
- **Pre-delete:** runs `check_trips` action first; if there are trip references, surfaces a confirm with the affected trip names.
- **Cache invalidation on success:** `["places"]`, `["lists"]`, `["trips"]`.
- **Used by:** `/places` page when one or more places are selected.

## `InlineCategoryCreator`

- **File:** `src/components/places/inline-category-creator.tsx`
- **Props:** `{ onCreated?: (categoryId: string) => void }`.
- **Hooks:** `useState`, [[../hooks/use-categories|`useCreateCategory`]].
- **UI:** Popover with name input + 12 preset color swatches. Outline indicator on the selected color.
- **Used by:** `AddPlaceDialog`.

## `InlineListCreator`

- **File:** `src/components/places/inline-list-creator.tsx`
- **Props:** `{ onCreated?: (listId: string) => void }`.
- **Hooks:** `useState`, [[../hooks/use-lists|`useCreateList`]].
- **UI:** Popover with name input only (no color picker).
- **Used by:** `AddPlaceDialog`.

## `InlineTagInput`

- **File:** `src/components/places/inline-tag-input.tsx`
- **Props:** `{ selectedTagIds: string[]; onChange: (tagIds: string[]) => void }`.
- **Hooks:** `useState`, `useRef`, [[../hooks/use-tags|`useTags`/`useCreateTag`]].
- **UI:** Autocomplete with live suggestions. Enter creates a new tag if no exact match. Backspace on empty input removes last selected tag.
- **Notes:** `onMouseDown preventDefault` on the suggestion list to keep the input focused while clicking.
- **Used by:** `AddPlaceDialog`.

## `PlaceCard`

- **File:** `src/components/places/place-card.tsx`
- **Props:** `{ place: Place }`.
- **No hooks**, no state. Pure presentation.
- **Renders:** photo (if any), visit-status badge overlay or slim header, name, address, first 2 tags + overflow, category badge with color dot, user rating (orange) and/or Google rating (gray), city/country, Google Maps external link.
- **Navigation:** clicking the card navigates to `/places/{place.id}`.
- **Used by:** `/places` page (grid).

## `VisitStatusToggle` + `VisitStatusBadge`

- **File:** `src/components/places/visit-status-toggle.tsx`
- **Two exports:**
  - `VisitStatusToggle` — interactive. Props: `{ value, onChange, size? }` (`"sm"` or `"md"`).
  - `VisitStatusBadge` — display-only. Props: `{ status }`.
- **No hooks.** Stateless.
- **UI:** 4 buttons (Bookmark/CalendarCheck/CheckCircle2/Heart) with status-specific colors (amber/blue/emerald/red). Toggle: clicking the active one deselects.
- **Used by:** `AddPlaceDialog`, `MapContent` (detail panel), `PlaceCard` (badge), trip/place detail pages.

## Cross-component notes

- **Inline creators (`InlineCategoryCreator`, `InlineListCreator`, `InlineTagInput`)** all follow the same pattern: small popover, optimistic UI via the matching mutation hook, `onCreated` callback to bubble the new ID to the parent.
- **`BulkActionBar`** is the only Place component that talks directly to `/api/places/bulk` instead of via a hook — because the bulk action shape is heterogeneous (action + variable payload).

## Open questions

- **`AddPlaceDialog` is huge** (handles parse, preview, enrich x2). Worth splitting into `ParseStep` and `ConfirmStep` sub-components.
- **`VisitStatusToggle` color hard-coded.** If we ever tokenize the status colors, update them centrally rather than per-button.
