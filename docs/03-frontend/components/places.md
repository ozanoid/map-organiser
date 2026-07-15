---
title: Places components
type: component
domain: frontend
version: 1.4.2
last_updated: 15.07.2026
status: stable
sources:
  - src/components/places/add-place-dialog.tsx
  - src/components/places/ai-summary-card.tsx
  - src/components/places/amenities-grid.tsx
  - src/components/places/bulk-action-bar.tsx
  - src/components/places/inline-category-creator.tsx
  - src/components/places/inline-list-creator.tsx
  - src/components/places/inline-tag-input.tsx
  - src/components/places/place-action-links.tsx
  - src/components/places/place-card.tsx
  - src/components/places/place-status-badges.tsx
  - src/components/places/place-topics.tsx
  - src/components/places/popular-times-widget.tsx
  - src/components/places/rating-distribution-bar.tsx
  - src/components/places/reviews-section.tsx
  - src/components/places/similar-places.tsx
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

Sixteen files under `src/components/places/`. All `"use client"`. The Place-related UI surface.

> **v1.17.0 (S1-PR1):** seven detail-page widgets extracted out of the
> 1,155-line `places/[id]/page.tsx` into standalone components (below) —
> behavior-preserving, plus the NF-06 review layer (owner answers, photo
> lightbox, Local Guide chip, helpful votes) in `ReviewsSection`.

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

## Detail-page widgets (extracted v1.17.0)

All seven render inside `places/[id]/page.tsx`'s DataForSEO extended
block (except `ReviewsSection`, which renders for any place with
reviews or a `google_place_id`). Every one is data-gated: renders
`null` (or is conditionally mounted by the page) when its
`google_data` field is absent — extended-data coverage is ~28% of
places, so empty states are the norm, not the exception.

### `RatingDistributionBar`
`{ distribution: Record<string, number> }` — NF-01. CSS-only 5→1 star
bars with counts; percentages derived from the distribution total.

### `PopularTimesWidget`
`{ popularTimes: Record<string, Array<{hour, popular_index}> | null | undefined> }`
— NF-02. Day-pill selector (defaults to today) + 6-23h bar chart,
current hour highlighted. Type deliberately admits `null` days
(DataForSEO returns them; the pre-refactor cast hid it and could
crash). Renders `null` only when ALL days are empty; a single empty
day shows "No data for this day."

### `PlaceStatusBadges`
`{ currentStatus?: string; isClaimed?: boolean }` — NF-04 (badge leg).
Status dot + label (opened / closed / temporarily_closed /
closed_forever) + "Verified" chip. The field only populates after the
v1.17.0 extraction-path fix — stored places gain it on next refresh.

### `PlaceActionLinks`
`{ bookOnlineUrl?: string; links?: Array<{type, url, title?}> }` —
NF-06 (action leg). "Book Online" + one outline button per
local_business_link (menu icon for `type === "menu"`).

### `AmenitiesGrid`
`{ attributes: Record<string, boolean> }` — NF-04 (grid leg). Boolean
attribute chip wall; green check = available, gray strikethrough =
unavailable. Grouping/icons deferred to S1-PR2.

### `PlaceTopics`
`{ topics, reviews, activeTopic?, onTopicClick? }` — NF-03 (completed
v1.18.0). Top-15 topics ordered by Google's pool-wide counts, but the
paren shows the LOCAL match count (token-AND matcher shared with the
reviews filter via `lib/places/topic-match.ts`); zero-match chips are
muted/non-clickable. Clicking filters ReviewsSection (page owns state).

### `ReviewsSection`
`{ reviews, hasPlaceId, provider?, refreshing, enriching, onRefresh }`
— paginated (5/page) review list with newest-first sort toggle and a
refresh button. **NF-06 review layer:** `owner_answer` (indented muted
block + `owner_time_ago`), `images` (thumbnail strip → Dialog lightbox
with prev/next), `local_guide` chip, `votes_count` ("N people found
this helpful"). All four fields are optional on `GoogleReview` — they
exist only on reviews fetched after the v1.17.0 data-layer upgrade, so
old corpora render exactly as before until refreshed.

### `SimilarPlaces` (v1.18.0, NF-05)
`{ items: Array<{title, cid?, rating?, category?, votes_count?}> }` —
people_also_search as a horizontal card strip (max 6); cards show title,
category and ★rating (compact vote count). **Single-path preview flow**
(final design after preview testing): clicking a card opens
`AddPlaceDialog` pre-filled with `https://maps.google.com/?cid=…`
(parse-link handles `?cid=` natively) — the user gets the same
first-class preview as a manual add (photo, hours, lite AI profile +
chips, pickers) and decides there; save = standard `POST /api/places` +
enrich chain with `source: "similar"` (dialog's new `source` prop). The
interim one-click `/api/places/add-similar` route was removed.
Membership via the client-cached `usePlaces({})` CID set; existing
suggestions render "Added ✓" and navigate to the place.

> **v1.18.0 updates to the widgets above:** `PlaceStatusBadges` gained the
> honest live open-now badge ("Open now · closes 23:00" / "Open 24 hours" /
> "Closed now") computed render-time from `work_timetable`+`tz`;
> `PlaceTopics` chips are clickable (NF-03 → filters ReviewsSection, page
> owns the state); `ReviewsSection` accepts `topicFilter`/`onClearTopicFilter`
> (header chip + count, clamped pagination); `AmenitiesGrid` is grouped +
> iconized via `src/lib/places/attribute-icons.ts` (NF-04).

## Cross-component notes

- **Inline creators (`InlineCategoryCreator`, `InlineListCreator`, `InlineTagInput`)** all follow the same pattern: small popover, optimistic UI via the matching mutation hook, `onCreated` callback to bubble the new ID to the parent.
- **`BulkActionBar`** is the only Place component that talks directly to `/api/places/bulk` instead of via a hook — because the bulk action shape is heterogeneous (action + variable payload).

## Open questions

- **`AddPlaceDialog` is huge** (handles parse, preview, enrich x2). Worth splitting into `ParseStep` and `ConfirmStep` sub-components.
- **`VisitStatusToggle` color hard-coded.** If we ever tokenize the status colors, update them centrally rather than per-button.
