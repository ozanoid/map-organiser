---
title: Place Search Flow
type: flow
domain: places
version: 1.2.0
last_updated: 16.10.2026
status: stable
sources:
  - src/components/map/search-box.tsx
  - src/components/map/search-result-panel.tsx
  - src/components/map/map-content.tsx
  - src/lib/hooks/use-place-search.ts
  - src/app/api/search/suggest/route.ts
  - src/app/api/search/retrieve/[id]/route.ts
  - src/app/api/places/route.ts
related:
  - "[[manual-place-create-flow]]"
  - "[[instagram-import-flow]]"
  - "[[../01-domain/places]]"
  - "[[../02-backend/api-routes/search]]"
  - "[[../04-integrations/mapbox]]"
  - "[[../04-integrations/dataforseo]]"
---

# Place Search Flow

Search-on-map → save. The user types into the search box on `/map`, picks a Mapbox autocomplete suggestion, sees enriched details in a slide-in panel, and saves it to their places. Parallel to the URL-paste flow ([[manual-place-create-flow]]) — both end at `POST /api/places`.

## Trigger

User focuses the search input that sits on top of the map view (top-left, beside the mobile filter button).

**Hand-off from the Instagram import (v1.28.0).** A skipped venue without
options has a **Search** button, the dialog's branch picker has **Search the
map**, and an empty result has **Search manually**. Each closes the Add Place
dialog and calls `SearchBoxHandle.search(name, { proximity })`
(`src/components/map/search-box.tsx`), which puts the venue name in the box,
opens the suggestions and focuses the input — the flow continues from step 1 as
if the name had been typed ("Search manually" passes an empty name and only
focuses the box). When the import knows where the venue is (v1.28.1 — its
`near`: the post's area, the profile's coordinates or the location tag; else the
centre of its options or of the post's other places), the map first flies there
at zoom 12 and the suggestions stay inside a box of about 30 km around that
point until the box is cleared or a result is picked — proximity alone only
ranks, and Mapbox put Indonesian and US archives first for "Westminster
Libraries and Archives" even with London as the proximity; with the box the
answer is an honest "No places found". A place saved this
way is an ordinary search save (`source: "mapbox_search"`), but its form starts
with the post link as the note and the `instagram` tag selected
(`SearchResultPanel` `prefill`), both editable. See [[instagram-import-flow]].

## Steps

```
1. User types in SearchBox (≥ 2 chars)
       │  usePlaceSearch debounces 300ms
       ▼
2. GET /api/search/suggest?q=…&session_token=<uuidv4>&proximity=<lng,lat>[&bbox=…]
       │  • proximity (v1.28.1) = the viewport center, rounded to 0.01°
       │    (≈ 1 km), or the point an Instagram hand-off aimed the search at
       │  • bbox (v1.28.1) only for an aimed search: ~30 km around that point
       │  • Server proxies Mapbox /searchbox/v1/suggest
       │  • types=poi, language=en; proximity biases, bbox filters
       │  • Returns up to 8 SearchSuggestion[]
       │
       ▼ Dropdown shows results
3. User clicks a suggestion
       │  SearchBox closes the dropdown, fires retrieve
       ▼
4. GET /api/search/retrieve/[mapbox_id]?session_token=<uuidv4>
       │  • Mapbox /retrieve → name, lat, lng, address, country, city, …
       │  • trackUsage("mapbox_search_session")  ← 1 billable Mapbox session
       │  • If DataForSEO configured:
       │      fetchBusinessInfoLive({
       │        keyword: "<name>, <full_address>",          ← address pad disambiguates
       │        location_coordinate: "lat,lng,1000",        ← 1km radius absorbs drift
       │      })
       │      → enriches with rating, opening_hours, photoRef, cid/place_id, extended fields
       │      → trackUsage("dataforseo_business_info_live")
       │  • Returns RetrievedPlaceData (parse-link-compatible shape)
       │
       ▼ MapContent
5. setSearchResult(data) + mapRef.flyToCoords({lng, lat, zoom: 16})
       │  Temporary marker rendered on MapView via searchMarker prop
       │  Detail panel (if any) closes; FAB/visible-place badge hide
       ▼
6. SearchResultPanel renders (desktop: right slide-in; mobile: half-height bottom sheet)
       │  Auto-resolves category from poi types (resolveCategoryId)
       │  User can override: category, lists, tags, visit status, rating, notes
       ▼
7. User clicks "Save to my places"
       │  POST /api/places { name, lat, lng, address, country, city,
       │                      category_id, rating, notes,
       │                      google_place_id (DataForSEO match) | undefined,
       │                      google_data: { types, rating, ..., mapbox_id, ...(_extended) },
       │                      photoRef, source: "mapbox_search",
       │                      visit_status, tag_ids, list_ids }
       │  • Server dedups by google_place_id if present (409 on dup)
       │  • Auto-categorizes from types if category_id missing
       │  • Inserts list_places, place_tags as needed
       │  • Downloads photoRef to Supabase Storage if present
       │
       ▼
8. onSuccess (mirrors AddPlaceDialog's two-step pattern)
       │  • Toast "<name> saved!", panel closes (clears searchResult)
       │  • AWAIT POST /api/places/[id]/enrich?step=info
       │      → DataForSEO business_info refresh + photo idempotent re-write
       │      → returns { ok: true, cid?: "<decimal>" }
       │      → React Query invalidates ["places"] after info resolves
       │  • If cid (from info response, or _extended.cid as fallback):
       │      fire-and-forget POST /api/places/[id]/enrich?step=reviews
       │      → /places/[id] polling picks it up within ~30s
       │  • On info error (e.g. mapbox-only result with no google_place_id):
       │      caught silently, still invalidate ["places"]
       ▼
9. New place appears on map (existing places source refetched)
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | search string + session token | up to 8 Mapbox POI suggestions |
| 4 | mapbox_id + session token | unified place payload (DataForSEO-enriched when match) |
| 7 | full form | new `places` row + optional `list_places` + `place_tags` + Storage photo |
| 8a (awaited) | place id | DataForSEO info merged into `google_data`, cid surfaced |
| 8b (optional) | `cid` | reviews merged into `google_data.reviews` |

## Provider preference

| Condition | What `_provider` is |
|---|---|
| `DATAFORSEO_*` env set AND DataForSEO returns a match | `dataforseo` |
| Otherwise (no env, or empty result) | `mapbox` |

There is **no Google Places path** in this flow even when the user has a personal Google API key. Google is reserved for URL paste / parse-link.

## Failure modes

- **Mapbox suggest fails:** dropdown shows "No places found." (empty array fallback). User can clear and try again.
- **Mapbox retrieve fails:** `404` returned, panel stays closed, hook's `retrieveError` surfaces. Today the SearchBox swallows it silently — could be a toast.
- **DataForSEO fails or returns empty:** `_provider: "mapbox"`, minimal data. Save still works; user gets a place with no rating / photo / opening hours. Manual "Refresh Google data" from place detail page can backfill later.
- **Save fails — 409 duplicate:** the user already saved this place (matched by `google_place_id`). Toast shows the server error.
- **Save fails — network:** toast, panel stays open with user's selections intact.

## Cost model

For one suggest→retrieve→save:

- ≥ 1 Mapbox suggest HTTP call (per keystroke after debounce). All within one session.
- 1 Mapbox retrieve HTTP call. → **1 billable Mapbox session** ($11.50/1000, 500 free/month).
- 1 DataForSEO business_info call during retrieve (when env set + match found). ($5.40/1000).
- **1 extra DataForSEO business_info call on save** via `step=info` — re-asserts google_data + DB roundtrip guarantee. (~$0.0054, matches AddPlaceDialog's cost profile.)
- 0 or 1 DataForSEO reviews call (background, when cid).
- 1 Supabase `INSERT places` (+ junction inserts + 1 Storage upload if photoRef).

## Related code

- `src/components/map/search-box.tsx` — search input + dropdown.
- `src/components/map/search-result-panel.tsx` — preview + save form.
- `src/components/map/map-content.tsx` — orchestrator + temporary marker wiring; the viewport center for the proximity bias.
- `src/components/map/map-view.tsx` — `flyToCoords`, `getCenter`, `searchMarker` prop.
- `src/lib/hooks/use-place-search.ts` — debounce, session token, mutations.
- `src/lib/mapbox/search-box.ts` — server-side suggest/retrieve.
- `src/app/api/search/suggest/route.ts`, `src/app/api/search/retrieve/[id]/route.ts` — proxies.
- `src/app/api/places/route.ts` — final save.

## Open questions

- **Tıklanabilir POI labels.** Mapbox `streets-v12` style already renders POI labels visually but clicking them does nothing. A future iteration could attach click handlers (or migrate to Mapbox Standard's `addInteraction` API) — out of scope for v1 of this feature.
- **Search-from-anywhere.** Today the search box lives only on `/map`. If `/places` or `/lists/[id]` ever need a "find a new place to add" widget, this hook is reusable; the SearchBox component is map-page-specific.
