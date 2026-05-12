---
title: Map components
type: component
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/components/map/map-view.tsx
  - src/components/map/map-content.tsx
  - src/lib/map/category-icons.ts
related:
  - "[[_README]]"
  - "[[../hooks/use-map-style]]"
  - "[[../hooks/use-places]]"
  - "[[../../04-integrations/mapbox]]"
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
    className?: string;
  }
  ```

- **Ref API:** `flyToPlace(placeId)` — pan + zoom to a specific place.
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
- **Hooks:** `useState`, `useEffect`, `useCallback`, `useRef`, `useSearchParams`, `useRouter`, `useQueryClient`, `useFilters`, `usePlaces`, `useCategories`, `useMapStyle`.
- **State managed:**
  - `addOpen` (Add Place dialog).
  - `filterOpen` (mobile filter sheet).
  - `visiblePlaceIds` (places in the current viewport).
  - `placeListOpen` (the dropdown showing visible places).
  - `selectedPlace` (currently focused place — drives detail panel).
  - `detailData` / `detailLoading` (fetched full detail).
  - `sharedUrl` (parsed from `?add=` query param).
- **API calls (inline, not via hooks):**
  - `GET /api/places/[id]` to fetch detail panel data.
  - `PATCH /api/places/[id]` to update visit status / rating from the detail panel.
  - `POST /api/places/[id]/enrich?step=info` for extended data.
  - `POST /api/places/[id]/enrich?step=reviews` (background).
- **Composes:**
  - `MapView` (with ref).
  - `FilterPanel` (desktop) / `FilterSheet` (mobile).
  - `AddPlaceDialog`.
  - Skeletons, badges, buttons from shadcn.
- **Behavior:**
  - Reads `?add=<url>` on mount and opens Add Place dialog with `initialUrl`.
  - Manages browser history (pushState/popState) so the mobile back button closes the detail panel.
  - Invalidates React Query caches after rating/visit-status mutations.
  - Renders a visible-place-count badge with an expandable dropdown list of places currently in the viewport (uses `MapView.flyToPlace` ref).
  - Renders a floating action button to open the Add Place dialog.
- **Used by:** `/map` page.

## `src/lib/map/category-icons.ts`

Not a component, but the engine behind the symbol layer. Renders Lucide SVG + category color to a canvas, then `map.addImage()` registers them as sprite IDs (`cat-utensils`, `cat-coffee`, …) the symbol layer references via `["concat", "cat-", ["get", "categoryIcon"]]`.

12 default category icons are shipped; user-added categories fall back to `map-pin`.

## Open questions

- **Stable ref dance.** `MapView` uses extensive `useRef` to stabilize event handlers — necessary today but the complexity is a maintenance burden. A future refactor could use `useEvent` once it lands.
- **Visible-place-count payload.** Recomputed on every viewport change; debounced. If place count grows huge, consider Mapbox's `queryRenderedFeatures` instead of filtering client-side.
- **Detail-panel API calls inline.** Could be lifted to hooks (e.g. `usePlaceDetail`, `useEnrichInfo`). Today they're inline because they're page-specific.
