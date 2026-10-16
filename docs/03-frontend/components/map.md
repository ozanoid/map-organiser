---
title: Map components
type: component
domain: frontend
version: 1.3.0
last_updated: 16.10.2026
status: stable
sources:
  - src/components/map/map-view.tsx
  - src/components/map/map-content.tsx
  - src/components/map/search-box.tsx
  - src/components/map/search-result-panel.tsx
  - src/lib/map/category-icons.ts
related:
  - "[[_README]]"
  - "[[../hooks/use-map-style]]"
  - "[[../hooks/use-places]]"
  - "[[../hooks/use-instagram-import]]"
  - "[[../../04-integrations/mapbox]]"
  - "[[../../05-flows/instagram-import-flow]]"
  - "[[../design-system/_README#custom-map-markers]]"
---

# Map components

Two components. `MapView` is a self-contained Mapbox renderer; `MapContent` is the page-level container that wires it up with filters, place detail panel, share-target intake, etc.

## `MapView`

- **File:** `src/components/map/map-view.tsx`
- **`"use client"`** with `forwardRef` — exposes an imperative handle.
- **Props:**

  ```ts
  {
    places: Place[];
    categories?: Category[];
    onPlaceClick?: (place: Place) => void;
    onVisiblePlacesChange?: (visibleIds: string[]) => void;
    mapboxToken?: string;
    mapStyle?: string;
    markerStyle?: "icons" | "dots";
    routeLines?: RouteLine[];
    searchMarker?: { lng: number; lat: number; color?: string } | null;
    className?: string;
  }
  ```

- **Ref API (`MapViewHandle`):**
  - `flyToPlace(placeId)` — pan + zoom to a saved place (and trigger `onPlaceClick`).
  - `openPlacePopup(placeId)` — fly to a saved place and open its marker balloon, as if the pin was clicked (v1.23.2 — a search that resolves to an already-saved place).
  - `flyToCoords({ lng, lat, zoom? })` — pan + zoom to arbitrary coordinates (search results).
  - `fitToCoords(points)` — frame a set of `{ lng, lat }`: one point flies to it at zoom 16, several fit their bounds (`padding: 80`, `maxZoom: 15`); empty is a no-op. Used by the Instagram import's **Show on map** (v1.28.0).
  - `getCenter()` — current viewport center, returns `{ lng, lat } | null`.
- **Hooks:** `useRef`, `useEffect`, `useState`, `useCallback`, `useImperativeHandle`.
- **State:** `mapLoaded` (boolean), refs to the map instance and stable callback identities.
- **Mapbox layers managed:**
  - GeoJSON source for places.
  - Cluster circle layer (when zoomed out).
  - Either `circle` (dots) or `symbol` (icons) layer for individual markers.
  - Optional `line` layer for `routeLines` (trip polylines, day-colored).
  - Popup created on marker click (place name, address, rating, visit status).
- **Behavior:**
  - On mount: init Mapbox, register category icons, add layers.
  - On `places` change: update GeoJSON source.
  - On `mapStyle` change: `map.setStyle()` then re-apply custom layers on `style.load`.
  - On `markerStyle` change: swap layers between circle and symbol.
  - On viewport change: emit visible place IDs via `onVisiblePlacesChange` (debounced).
  - On marker click: emit `onPlaceClick(place)`.
- **`fitBounds` on initial load only** — filter changes don't re-fit the camera (intentional, to keep the view stable).
- **`fadeDuration: 0`** — cluster count text disappears instantly when zooming in.

## `MapContent`

- **File:** `src/components/map/map-content.tsx`
- **`"use client"`**.
- **Props:** `{ mapboxToken: string }`.
- **Hooks:** `useState`, `useEffect`, `useCallback`, `useRef`, `useSearchParams`, `useRouter`, `useQueryClient`, `useFilters`, `usePlaces`, `useCategories`, `useMapStyle`, [[../hooks/use-instagram-import|`useInstagramImport`]] (background watcher). (Search lifecycle owned by `SearchBox`'s internal `usePlaceSearch`.)
- **State managed:**
  - `addOpen` (Add Place dialog).
  - `filterOpen` (mobile filter sheet).
  - `visiblePlaceIds` (places in the current viewport).
  - `placeListOpen` (the dropdown showing visible places).
  - `selectedPlace` (currently focused place — drives detail panel).
  - `detailData` / `detailLoading` (fetched full detail).
  - `sharedUrl` (parsed from `?add=` query param).
  - Instagram import (v1.28.0): `igJob` (`{ url, id }` of the job shown in the
    dialog — seeded from `?ig=<jobId>` on mount), `igDialogOpen` (the dialog is
    open for that job; the dialog's `open` is `addOpen || igDialogOpen`),
    `igWatchId` (a job closed mid-way, watched in the background), and refs
    `igPhaseRef` (last phase the panel reported) and `igNotified` (toast once per
    job).
  - `searchBoxRef` (`SearchBoxHandle`) — lets the Instagram panel fill the search box.
- **API calls (inline, not via hooks):**
  - `GET /api/places/[id]` to fetch detail panel data.
  - `PATCH /api/places/[id]` to update visit status / rating from the detail panel.
  - `POST /api/places/[id]/enrich?step=info` for extended data.
  - `POST /api/places/[id]/enrich?step=reviews` (background).
- **Composes:**
  - `MapView` (with ref).
  - `FilterPanel` (desktop) / `FilterSheet` (mobile).
  - `SearchResultPanel` (search → save), `AddPlaceDialog`.
  - Marker detail: the inline side-panel on desktop; `PlaceDetailSheet`
    (full detail bottom-sheet) on mobile — gated by `useIsDesktop` (v1.24.0).
  - Skeletons, badges, buttons from shadcn.
- **Behavior:**
  - Reads `?add=<url>` on mount and opens Add Place dialog with `initialUrl` (then `router.replace("/map")`). An Instagram post/reel link puts the dialog in Instagram mode — see [[../../05-flows/instagram-import-flow]].
  - **Instagram import wiring (v1.28.0):**
    - `onInstagramJob` stores the job and writes `?ig=<jobId>` via `setIgParam`, which edits only `ig` and keeps the rest of the query string (the filters). A refresh with `?ig=` reopens the dialog on that job.
    - `closeAddDialog` (every close path) clears `?ig` when a job is shown; if the last phase seen was not `done`/`failed` it sets `igWatchId`, so `useInstagramImport` keeps polling. When that job ends it invalidates `["places"]` and toasts once — "N places added from Instagram" / "No new places from that Instagram post" / "Couldn't add from that Instagram post" — with a **View** action (`reopenInstagram`) that reopens the dialog on the job.
    - `onShowOnMap(points)` → close the dialog, `mapRef.fitToCoords(points)`.
    - `onSearchPlaces(query, context)` → close the dialog, keep `context` as `igSearchContext`, `searchBoxRef.search(query)`. The next `SearchResultPanel` gets `prefill = { notes: postUrl, tagIds: [tagId] }`; the context clears when that panel closes or the pick is an already-saved place.
    - The filter-persist mirror drops `ig` from the query string it stores, so nav links back to `/map` never reopen an import dialog.
  - Manages browser history (pushState/popState) so the mobile back button
    closes the detail panel/sheet (the mobile sheet's `onClose` calls
    `history.back()` to stay in sync).
  - Invalidates React Query caches after rating/visit-status mutations.
  - Renders a visible-place-count badge with an expandable dropdown list of places currently in the viewport (uses `MapView.flyToPlace` ref).
  - Renders a floating action button to open the Add Place dialog.
- **Used by:** `/map` page.

## `SearchBox`

- **File:** `src/components/map/search-box.tsx`
- **`"use client"`**.
- **Props:**
  ```ts
  {
    proximity?: { lng: number; lat: number };
    onSelect: (place: RetrievedPlaceData) => void;
    className?: string;
    ref?: Ref<SearchBoxHandle>; // v1.28.0 — React 19 ref-as-prop, no forwardRef
  }
  ```
- **Ref API (`SearchBoxHandle`, v1.28.0):** `search(text)` — sets the query, opens the suggestions dropdown and focuses the input, as if the user had typed it. Used by `MapContent` for the Instagram import's **Pick branch** / **Search** / **Search manually** hand-off ([[../../05-flows/place-search-flow]] takes over from there).
- **Hooks:** [[../hooks/use-place-search|`usePlaceSearch`]], `useState`, `useEffect`, `useRef`, `useImperativeHandle`.
- **UI:** Pill-shaped input with `Search` icon and `Loader2` spinner while suggest/retrieve is in flight. Absolute-positioned dropdown beneath shows up to 8 Mapbox POI suggestions; each row has `MapPin` icon + name + place_formatted address. Click outside or pick a result closes the dropdown.
- **Behavior:**
  - Min 2 chars to fire suggest (handled in the hook).
  - On select → calls `onSelect(retrievedData)` with the enriched `RetrievedPlaceData`; clears the input.
  - "No places found" message after a non-empty query yields zero suggestions.
- **Used by:** `MapContent`.

## `SearchResultPanel`

- **File:** `src/components/map/search-result-panel.tsx`
- **`"use client"`**.
- **Props:**
  ```ts
  {
    place: RetrievedPlaceData;
    onClose: () => void;
    /** v1.28.0 — starting notes/tags (Instagram "Pick branch"); initial state only. */
    prefill?: { notes?: string; tagIds?: string[] };
  }
  ```
- **Hooks:** `useState`, `useEffect`, `useMemo`, `useQueryClient`, [[../hooks/use-places|`useCreatePlace`]], [[../hooks/use-categories|`useCategories`]], [[../hooks/use-subcategories|`useSubcategories`]], [[../hooks/use-lists|`useLists`]], [[../hooks/use-tags|`useTags`]].
- **API:**
  - `POST /api/places` with `source: "mapbox_search"`.
  - **Awaited** `POST /api/places/[id]/enrich?step=info` (DataForSEO business_info refresh + photo, hands back `cid`). Mirrors `AddPlaceDialog`'s two-step pattern to avoid a polling race vs. POST `/api/places`'s async photo-download UPDATE.
  - **Fire-and-forget** `POST /api/places/[id]/enrich?step=reviews` using the info response's `cid` (falls back to `_extended.cid`).
- **UI:** Responsive (runtime [[../hooks/use-is-desktop|`useIsDesktop`]], lg=1024px — mounts on interaction, no hydration flash). Same pre-filled content in both: photo / address / quick-facts (rating, opening hours, website, phone, city/country), form for category / lists / tags / visit status / rating / notes.
  - **Desktop (≥lg):** right side-panel — fixed header (title + X), scrolling body, sticky footer (Cancel / Save).
  - **Mobile (<lg):** Google-Maps-style draggable bottom sheet (`ui/drawer.tsx` `Drawer`, `snapPoints=[0.5, 0.92]`, `modal={false}`). Opens at **half**; drag up from the whole `DrawerHeader` (a `touch-none` drag zone) to full. **Swipe-down never closes** — `onOpenChange` cancels `reason === "swipe"` so it springs back to half; only X / Cancel close it (`disablePointerDismissal` blocks outside-tap close too). Cancel/Save live in the always-visible header because base-ui translates the popup down by the snap offset, so a bottom footer would sit below the fold at half.
- **Behavior:**
  - Auto-resolves category from `place.types` via `resolveCategoryId`; falls back to "Other".
  - v1.22.1 — mirrors `AddPlaceDialog`'s lite-profile UI: subcategory chips under the selected parent (✨ on the AI-suggested one, auto-selected at confidence ≥0.85), plus an "AI Suggestions" block of matched tags + lists from `place.lite_profile`. Changing the parent category clears the subcategory. `MapContent` keys the panel by `_mapbox_id` so a new result resets the form.
  - On save success: toast, close, await `step=info` → invalidate `["places"]` → kick `step=reviews`.
  - On `step=info` error (e.g. mapbox-only result without `google_place_id`): still invalidates the cache so the new place renders without enrichment.
- **Used by:** `MapContent`.

## `src/lib/map/category-icons.ts`

Not a component, but the engine behind the symbol layer. Renders Lucide SVG + category color to a canvas, then `map.addImage()` registers them as sprite IDs (`cat-utensils`, `cat-coffee`, …) the symbol layer references via `["concat", "cat-", ["get", "categoryIcon"]]`.

12 default category icons are shipped; user-added categories fall back to `map-pin`.

## Open questions

- **Stable ref dance.** `MapView` uses extensive `useRef` to stabilize event handlers — necessary today but the complexity is a maintenance burden. A future refactor could use `useEvent` once it lands.
- **Visible-place-count payload.** Recomputed on every viewport change; debounced. If place count grows huge, consider Mapbox's `queryRenderedFeatures` instead of filtering client-side.
- **Detail-panel API calls inline.** Could be lifted to hooks (e.g. `usePlaceDetail`, `useEnrichInfo`). Today they're inline because they're page-specific.
