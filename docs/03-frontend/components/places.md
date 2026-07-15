---
title: Places components
type: component
domain: frontend
version: 1.2.0
last_updated: 15.07.2026
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
- **Hooks:** `useState`, `useEffect`, `useMemo`, `useQueryClient`, [[../hooks/use-places|`useParseLink`/`useCreatePlace`]], [[../hooks/use-categories|`useCategories`]], [[../hooks/use-subcategories|`useSubcategories`]], [[../hooks/use-lists|`useLists`]], [[../hooks/use-tags|`useTags`]].
- **API calls:**
  - `useParseLink` mutation (`POST /api/places/parse-link` — now returns `lite_profile` inline when AI is enabled).
  - `useCreatePlace` mutation (`POST /api/places` — accepts `subcategory_id` since Phase 3).
  - `POST /api/places/[id]/enrich?step=info` (awaited after save).
  - `POST /api/places/[id]/enrich?step=reviews` (fire-and-forget; chains to `step=profile` server-side when AI on).
- **State:** input URL, parsed place data, **lite profile**, provider info, category id, **subcategory id**, notes, rating, selected list/tag ids, visit status (default `want_to_go`).
- **Composes:** `InlineCategoryCreator`, `InlineListCreator`, `InlineTagInput`. shadcn `Dialog`, `Input`, `Textarea`, `Badge`, `Skeleton`, `Button`.
- **Flow:**
  1. Paste a Google Maps URL.
  2. `useParseLink` runs → preview card shows photo/rating/hours/etc. + `lite_profile` populates the chip area.
  3. **AI Suggestions panel** renders (Phase 3): suggested tag chips + suggested list chips. Opt-in — user clicks to accept. **No silent apply.**
  4. **Sub-category strip** renders under the parent category dropdown. The lite-resolver's pick carries a `✨ Sparkles` icon; auto-pre-selected when `sub_category_confidence ≥ 0.85`.
  5. User picks category, sub-category, lists, tags, visit status, optional rating + notes.
  6. `useCreatePlace` runs → place is saved.
  7. Two-phase enrichment after save: `info` (await) → `reviews` (fire-and-forget). When AI is enabled, the reviews route chains into `step=profile` (Phase 4) which populates `google_data.place_profile` and runs the 4-band auto-apply for tags + sub-cat + category-change.
- **Used by:** `AppHeader` (Add Place button), `MapContent` (FAB + share-target intake).
- **Notes:** Auto-resolves category from Google `types` via `resolveCategoryId` (lite path). Displays which provider served the parse (Google vs DataForSEO) + fetch time. Sticky action buttons at the bottom. The AI Suggestions panel is hidden when no chips are produced (handles AI-off cleanly).

## `AiSummaryCard`

- **File:** `src/components/places/ai-summary-card.tsx` (Phase 4)
- **Props:** `{ placeId, profile?, reviewsAvailable, reviews?, onRefreshed? }`. `reviews` (15.07.2026) is read only to compare the newest review's `publish_time` against `profile.generated_at` for the staleness badge.
- **Renders:** Two states.
  - **Skeleton state** — reviews exist but `profile.completeness !== "full"`. Shows three skeleton lines + a `↻ generate` button (Phase 4 patch added the button to skeleton so pre-Phase-4 places can be backfilled manually).
  - **Full state** — an amber **staleness hint** when a stored review is newer than the summary (15.07.2026 — safety net; the refresh chain normally regenerates automatically) + TLDR paragraph + two-column **✓ Highlights** (pros) / **⚠ Watch out** (cons) lists + theme-insight pills (sentiment emoji + mention count + click-to-expand evidence quote) + distinctive feature pills. Refresh button (`↻ refresh`) in the top-right re-fires `step=profile`.
- **API call:** `POST /api/places/[id]/enrich?step=profile` on refresh.
- **Used by:** Place detail page (`src/app/(app)/places/[id]/page.tsx`) above the Amenities section.
- **Hidden when:** no reviews available (lets the existing "Loading reviews…" banner own that state).

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
