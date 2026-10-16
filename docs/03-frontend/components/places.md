---
title: Places components
type: component
domain: frontend
version: 1.7.0
last_updated: 16.10.2026
status: stable
sources:
  - src/components/places/add-place-dialog.tsx
  - src/components/places/instagram-import-panel.tsx
  - src/components/places/ai-compare-card.tsx
  - src/components/places/ai-summary-card.tsx
  - src/components/places/amenities-grid.tsx
  - src/components/places/bulk-action-bar.tsx
  - src/components/places/inline-category-creator.tsx
  - src/components/places/inline-list-creator.tsx
  - src/components/places/inline-tag-input.tsx
  - src/components/places/place-action-links.tsx
  - src/components/places/place-card.tsx
  - src/components/places/place-detail-view.tsx
  - src/components/places/place-detail-sheet.tsx
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
  - "[[../hooks/use-instagram-import]]"
  - "[[../../01-domain/places]]"
  - "[[../../05-flows/instagram-import-flow]]"
---

# Places components

Twenty files under `src/components/places/`. All `"use client"`. The Place-related UI surface.

> **v1.28.0:** `AddPlaceDialog` gained an **Instagram mode** — an Instagram
> post/reel link (pasted, or arriving as `/map?add=`) renders the new
> `InstagramImportPanel` instead of the parse-link preview. See below and
> [[../../05-flows/instagram-import-flow]].

> **v1.17.0 (S1-PR1):** seven detail-page widgets extracted out of the
> 1,155-line `places/[id]/page.tsx` into standalone components (below) —
> behavior-preserving, plus the NF-06 review layer (owner answers, photo
> lightbox, Local Guide chip, helpful votes) in `ReviewsSection`.

> **v1.24.0:** the whole `places/[id]/page.tsx` **body** was extracted into
> `PlaceDetailView` (behavior-preserving) so the same detail can render as a
> route OR inside `PlaceDetailSheet` — a mobile bottom-sheet that opens on
> the current page instead of navigating. See below.

## `PlaceDetailView`

- **File:** `src/components/places/place-detail-view.tsx`
- **Props:** `{ placeId: string; onBack: () => void; onDeleted: () => void; variant?: "page" | "sheet" }`.
- The full detail body — all fetching, the review/profile **polling** effects,
  and every mutation (rating, notes, lists, tags, visit-status, share, delete,
  refresh-google) live here. The route param and `router` navigation were
  replaced by the `placeId` prop + `onBack`/`onDeleted` callbacks so it works
  as a page or a sheet. `variant="sheet"` → full-width container and NO own
  header ✕/title (the enclosing `BottomSheet` drag header supplies both, so
  only the Share/Delete pair renders); `variant="page"` keeps the
  max-width-centered layout + "← Back".
- **Used by:** the `/places/[id]` route (thin wrapper: `onBack=router.back`,
  `onDeleted=router.push("/places")`) and `PlaceDetailSheet`.

## `PlaceDetailSheet`

- **File:** `src/components/places/place-detail-sheet.tsx`
- **Props:** `{ placeId: string; placeName: string; onClose: () => void }`.
  `placeName` populates the drag header immediately instead of waiting on the
  view's fetch.
- Renders [[ui-shadcn|`BottomSheet`]] around `<PlaceDetailView variant="sheet"
  onBack={onClose} onDeleted={onClose} />`, so it inherits the shared sheet
  contract — opens at half, the whole header drags, swipe-down never closes,
  only the ✕ closes. In `variant="sheet"` the view drops its own ✕ and title
  (the sheet header owns them) and renders just the Share/Delete pair.
- **Triggers (mobile, v1.24.0 experiment):** the Places grid cards (via
  `PlaceCard`'s `onOpenDetail`) and the map marker detail (`MapContent`
  renders it for `selectedPlace` when `!isDesktop`, `onClose = history.back()`
  to balance the panel's `pushState`). Desktop keeps navigation / the
  side-panel.

## `AddPlaceDialog`

- **File:** `src/components/places/add-place-dialog.tsx`
- **Props:** `{ open, onOpenChange, initialUrl?, source? }` plus five optional
  Instagram props (v1.28.0), passed only by `MapContent`:
  - `instagramJob?: { url: string | null; id: string } | null` — a job the page
    already knows (after a refresh from `/map?ig=<id>`, `url` is `null`).
  - `onInstagramJob?(job)` — a job started; the page keeps its id in the URL.
  - `onInstagramPhase?(phase)` — the latest phase seen, so the page knows whether
    a close happened mid-way.
  - `onShowOnMap?(points)` — frame these coordinates on the map.
  - `onSearchPlaces?(query, { postUrl, tagId })` — hand a venue name to the map
    search box, with the post it came from.
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
- **Instagram mode (v1.28.0):** when the pasted URL (`handlePaste`) or
  `initialUrl` is an Instagram post/reel link (`parseInstagramPostUrl`), or when
  `instagramJob` is set without an `initialUrl`, the dialog renders only
  `<InstagramImportPanel>` (`sm:max-w-lg`, `max-h-[90vh]`). The parse-link
  auto-fire skips Instagram URLs, so `parse-link` is never called for them. The
  panel receives the job whose `url` matches the canonical post URL (any job when
  there is no URL — the refresh case). Closing resets the Instagram state with
  the rest of the form.
- **Placeholder / hint:** "Paste a Google Maps or Instagram link..." and "Paste a
  Google Maps link to fill in the place, or an Instagram post to add the places
  in it".
- **Used by:** `AppHeader` (Add Place button), `MapContent` (FAB + `?add=` intake +
  `?ig=` restore — the only caller that passes the Instagram props),
  `SimilarPlaces` (`source="similar"`).
- **Notes:** Auto-resolves category from Google `types` via `resolveCategoryId` (lite path). Preview surfaces a free **View on Google Maps** link (`placeData.googleMapsUrl` already fetched by the parse — zero extra cost; v1.18.0). Displays which provider served the parse (Google vs DataForSEO) + fetch time. Sticky action buttons at the bottom. The AI Suggestions panel is hidden when no chips are produced (handles AI-off cleanly).

## `InstagramImportPanel`

- **File:** `src/components/places/instagram-import-panel.tsx` (v1.28.0)
- **Props:**

  | Prop | Type | Required | Notes |
  |---|---|---|---|
  | `url` | `string \| null` | yes | Canonical post URL. With no `jobId`, a job is started for it. `null` after a refresh — the job id is all there is. |
  | `jobId` | `string \| null` | yes | The job to show. |
  | `onJobId` | `(jobId: string) => void` | yes | A job was started (or reused, or retried). |
  | `onPhase` | `(phase) => void` | no | Fires on every phase change. |
  | `onClose` | `() => void` | yes | Close / Continue in background / Done. |
  | `onShowOnMap` | `(points) => void` | no | Map page only — enables **Show on map**. |
  | `onSearch` | `(query, { postUrl, tagId }) => void` | no | Map page only — enables **Pick branch** / **Search** / **Search manually**; the context lets the place saved from the search carry the post link and the `instagram` tag. |

- **Hooks:** [[../hooks/use-instagram-import|`useStartInstagramImport` / `useInstagramImport`]], `useQueryClient`, `useState`, `useRef`, `useEffect`.
- **Behavior:** there is no confirmation step — the server adds every venue it
  can pin on evidence and the panel reports what happened.
  - **Start once per URL.** A ref (`startedFor`) guards against React's
    development double mount; the server also hands back the same job for a
    repeat share within 10 minutes.
  - **Reading** — two-step progress ("Reading the post and finding places" →
    "Adding them to your map") and "You can close this. It keeps going and lets
    you know when it's done." Footer: **Continue in background**.
  - **Adding** — title "Adding N places…", rows with spinners. `["places"]` is
    invalidated whenever the count of `added` items changes and when the job is
    done, so pins appear while it runs.
  - **Done, one place** — photo (Storage URL), name, address, evidence badges
    (emerald), `# instagram`, `Want to go` (new places), the note
    (`Note: instagram.com/p/…`) and "Wrong place? Remove it". Footer: **Edit**
    (link to `/places/[id]`) + **Show on map** (or **Done** without
    `onShowOnMap`).
  - **Done, several** — one row per item, sorted added/pending → already saved →
    skipped/failed: thumbnail or icon, name, and "evidence · address" (added),
    "Already in your places · tag and link added", the skip reason (e.g.
    "3 branches · the post doesn't say which", "More than one place matches",
    "Permanently closed on Google", "Couldn't confirm which place this is"), or
    "Couldn't add · <reason>". Added rows have **Remove**; skipped rows
    **Pick branch** (`chain_branch_unknown`) or **Search**, prefilled with the
    item's `searchName`. Footer: **Close** + **Show all on map** (or **Done**
    without `onShowOnMap`).
  - **Empty** — "No places in this post"; if no skipped venue is listed either,
    "No account, location tag or address in this post points to one specific
    place." Footer: **Close** + **Search manually** (with `onSearch`).
  - **Failed** — error copy per code (`post_unavailable`, `budget_exceeded`,
    `not_configured`, `service_error`, `stalled`, `invalid_url`), a start error's
    message, or "Couldn't load this import." **Try again** re-posts the URL,
    except for `budget_exceeded` and `not_configured`.
  - **Remove** — `DELETE /api/places/[id]` (deletes the place), then invalidates
    `["instagram-import", jobId]` and `["places"]` and toasts. The row becomes
    `removed` and disappears.
- **Accessibility:** progress list is `role="status"` + `aria-live="polite"`,
  the result list `aria-live="polite"`, errors `role="alert"`; decorative icons
  are `aria-hidden`.
- **Composition:** rendered by `AddPlaceDialog` inside its `DialogContent`;
  uses shadcn `DialogHeader` / `DialogTitle` / `DialogDescription`, `Badge`,
  `Button` (+ `buttonVariants` for the Edit link), lucide icons and a local
  inline SVG for the Instagram glyph (`InstagramGlyph`).
- **Styling:** body scrolls (`flex-1 overflow-y-auto min-h-0`); fixed footer with
  `border-t`; pink-600 glyph while working, emerald check when done, destructive
  alert icon on failure.

## `AiSummaryCard`

- **File:** `src/components/places/ai-summary-card.tsx` (Phase 4)
- **Props:** `{ placeId, profile?, reviewsAvailable, reviews?, onRefreshed? }`. `reviews` (15.07.2026) is read only to compare the newest review's `publish_time` against `profile.generated_at` for the staleness badge.
- **Renders:** Two states.
  - **Skeleton state** — reviews exist but `profile.completeness !== "full"`. Shows three skeleton lines + a `↻ generate` button (Phase 4 patch added the button to skeleton so pre-Phase-4 places can be backfilled manually).
  - **Full state** — an amber **staleness hint** when a stored review is newer than the summary (15.07.2026 — safety net; the refresh chain normally regenerates automatically) + TLDR paragraph + two-column **✓ Highlights** (pros) / **⚠ Watch out** (cons) lists + theme-insight pills (sentiment emoji + mention count + click-to-expand evidence quote) + distinctive feature pills. Refresh button (`↻ refresh`) in the top-right re-fires `step=profile`.
- **API call:** `POST /api/places/[id]/enrich?step=profile` on refresh.
- **Used by:** Place detail page (`src/app/(app)/places/[id]/page.tsx`) above the Amenities section.
- **Hidden when:** no reviews available (lets the existing "Loading reviews…" banner own that state).

## `AiCompareCard`

- **File:** `src/components/places/ai-compare-card.tsx` (S2 F-04, v1.19.0)
- **Props:** `{ places: Place[] }` (2-4, column order = idx order).
- **Behavior:** DELIBERATE-CLICK only — `POST /api/ai/compare` fires on the button, never on mount (each run burns one `ai_compare` unit, 200/mo). Renders `overall` + per-theme winners (trophy) + occasion picks; `idx` resolves via the route-echoed `order` array. Re-run link after first result.
- **Used by:** `/places/compare`.

## `BulkActionBar`

- **File:** `src/components/places/bulk-action-bar.tsx`
- **Props:** `{ selectedIds: Set<string>; onClear: () => void; onComplete: () => void }`.
- **Hooks:** `useState`, `useQueryClient`, `useCategories`, `useTags`, `useLists`.
- **API call:** `POST /api/places/bulk` with action and payload.
- **State:** `loading` (mutation in-flight).
- **Renders:** fixed bottom bar — selection count + clear, **Compare (v1.19.0 — enabled only for 2-4 selections → `/places/compare?ids=…`)**, four action dropdowns (Category, Tag, List, Status), and a delete button.
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
- **Props:** `{ place: Place; className?; onOpenDetail?: (place: Place) => void }`.
- **No hooks**, no state. Pure presentation.
- **Renders:** photo (if any), visit-status badge overlay or slim header, name, address, first 2 tags + overflow, category badge with color dot, user rating (orange) and/or Google rating (gray), city/country, Google Maps external link.
- **Navigation:** by default the card is a `<Link>` to `/places/{place.id}`. When
  `onOpenDetail` is passed (mobile grid, v1.24.0), it instead renders a
  `div[role=button]` that calls `onOpenDetail(place)` to open `PlaceDetailSheet`
  on the current page. The inner Maps `<a>` keeps its `stopPropagation`.
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

Primary consumer: `places/[id]/page.tsx`'s DataForSEO extended block; since v1.19.0 `RatingDistributionBar` + `PlaceStatusBadges` are ALSO reused by `/places/compare`. They render inside the extended
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
