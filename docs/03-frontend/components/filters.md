---
title: Filters
type: component
domain: frontend
version: 1.2.0
last_updated: 15.07.2026
status: stable
sources:
  - src/components/filters/category-filter.tsx
  - src/components/filters/country-city-filter.tsx
  - src/components/filters/debounced-search-input.tsx
  - src/components/filters/filter-panel.tsx
  - src/components/filters/filter-sheet.tsx
  - src/components/filters/list-filter.tsx
  - src/components/filters/tag-filter.tsx
  - src/components/filters/visit-status-filter.tsx
  - src/components/filters/open-now-filter.tsx
related:
  - "[[_README]]"
  - "[[../hooks/use-filters]]"
  - "[[../hooks/use-categories]]"
  - "[[../hooks/use-tags]]"
  - "[[../hooks/use-lists]]"
---

# Filters

> **v1.18.0:** new `OpenNowFilter` chip (panel + mobile sheet, "Hours" section) — toggles `PlaceFilters.open_now`; evaluation happens server-side at request time from stored timetable+tz in the place's local timezone. `sources:` += src/components/filters/open-now-filter.tsx.

Components under `src/components/filters/`. All `"use client"`. Two top-level containers (`FilterPanel` for desktop, `FilterSheet` for mobile) compose the same set of filter controls.

## Per-component

### `CategoryFilter` (with sub-category cascade)

- **File:** `src/components/filters/category-filter.tsx`
- **Props:** `{ selected?: string[]; onChange; selectedSubcategories?: string[]; onSubcategoryChange? }` — sub-cat callbacks are optional; when omitted the legacy single-row UI renders (no cascade).
- **Hooks:** [[../hooks/use-categories|`useCategories`]], [[../hooks/use-subcategories|`useSubcategories`]] (Phase 2).
- **Renders:**
  - Top row: "All" pill + one pill per category, color dot inline. Multi-select with toggle behavior.
  - **Cascade (Phase 2):** when one or more parent categories are active AND `onSubcategoryChange` is provided, a labeled sub-cat section appears under each active parent — small-caps parent name + the parent's sub-cat pills as multi-select chips. Deselecting a parent drops that parent's selected sub-cats automatically. "All" at the top clears both parent and sub-cat state.
- **Used by:** `FilterPanel`, `FilterSheet` — both wire `filters.subcategory_ids` / `setFilters({ subcategory_ids })` from [[../hooks/use-filters|`useFilters`]] so URL state mirrors via `?subcategory=<id,id>`.

### `CountryCityFilter`

- **File:** `src/components/filters/country-city-filter.tsx`
- **Props:** `{ country?, city?, onCountryChange, onCityChange }`.
- **Hooks:** `useQuery` (inline) that fetches unique country+city pairs directly from Supabase `places`.
- **UI:** Country dropdown; if a country is chosen, City dropdown appears below scoped to that country.
- **Used by:** `FilterPanel`, `FilterSheet`.
- **Notes:** Clearing country clears city. The inline Supabase query is the only place in the codebase that uses `useQuery` outside of `src/lib/hooks/` — worth refactoring into a `useCountriesAndCities` hook.

### `DebouncedSearchInput`

- **File:** `src/components/filters/debounced-search-input.tsx`
- **Props:** `{ value: string | undefined; onSearch: (value: string | undefined) => void; placeholder?: string; className?: string }`.
- **Hooks:** `useState` for local input, `useEffect` to sync from prop, [[../hooks/use-debounce|`useDebouncedCallback`]] (400 ms).
- **Pattern:** local state decouples typing speed from API calls. External prop wins on URL navigation (back/forward).

### `FilterPanel` (desktop)

- **File:** `src/components/filters/filter-panel.tsx`
- **Props:** none.
- **Hooks:** [[../hooks/use-filters|`useFilters`]].
- **Composes:** `DebouncedSearchInput`, `CountryCityFilter`, `CategoryFilter`, `TagFilter`, `ListFilter`, `VisitStatusFilter`, plus inline rating selectors, a sort dropdown, and a clear-all button.
- **Used by:** `MapContent` (desktop sidebar), filter slot in pages that show a desktop filter rail.
- **Notes:** Includes an inline `RatingStars` helper for the rating filter.

### `FilterSheet` (mobile)

- **File:** `src/components/filters/filter-sheet.tsx`
- **Props:** `{ open: boolean; onOpenChange: (open: boolean) => void }`.
- **Subcomponents:** shadcn `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`.
- **Otherwise identical to FilterPanel** — same filter controls, same hook. Different layout (bottom sheet) with `safe-area-inset-bottom` padding.

### `ListFilter`

- **File:** `src/components/filters/list-filter.tsx`
- **Props:** none.
- **Hooks:** [[../hooks/use-lists|`useLists`]], [[../hooks/use-filters|`useFilters`]].
- **UI:** Dropdown with all lists + place counts; "All lists" default.

### `TagFilter`

- **File:** `src/components/filters/tag-filter.tsx`
- **Props:** none.
- **Hooks:** [[../hooks/use-tags|`useTags`]], [[../hooks/use-filters|`useFilters`]].
- **UI:** Multi-select tag pills. Custom color or emerald-600 default. Shows "No tags yet" when empty.

### `VisitStatusFilter`

- **File:** `src/components/filters/visit-status-filter.tsx`
- **Props:** none.
- **Hooks:** [[../hooks/use-filters|`useFilters`]].
- **UI:** Five buttons — All, Want to go, Booked, Visited, Favorite (with Bookmark, CalendarCheck, CheckCircle2, Heart icons). Single-select; clicking the active one deselects.

## Cross-component patterns

- **State lives in `useFilters`** — every component reads + writes via that hook (no prop drilling beyond container).
- **`DebouncedSearchInput` is the only one with internal state** — because it needs to track typing locally before debounce flush.
- **`FilterPanel` and `FilterSheet` are siblings** — the same set of controls in two layouts. If you add a new control, add it to both (and update [[../hooks/use-filters]] if it's a new filter key).

## Open questions

- **`CountryCityFilter` does its own Supabase query.** Pull this into `src/lib/hooks/use-country-city.ts` for consistency.
- **`FilterPanel` ↔ `FilterSheet` divergence.** Both files repeat the layout structure. A shared `FilterControls` body component would make adding new filters less error-prone.
