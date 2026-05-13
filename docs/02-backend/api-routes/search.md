---
title: Search routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 13.05.2026
status: stable
sources:
  - src/app/api/search/suggest/route.ts
  - src/app/api/search/retrieve/[id]/route.ts
  - src/lib/mapbox/search-box.ts
related:
  - "[[_README]]"
  - "[[../../04-integrations/mapbox]]"
  - "[[../../04-integrations/dataforseo]]"
  - "[[../../03-frontend/hooks/use-place-search]]"
  - "[[../../05-flows/place-search-flow]]"
---

# Search routes

Two server-side proxies around Mapbox Search Box API plus optional DataForSEO enrichment. Drive the "search for a place on the map and save it" flow on `/map`.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/search/suggest` | Required | Mapbox `/suggest` proxy — autocomplete suggestions. |
| `GET` | `/api/search/retrieve/[id]` | Required | Mapbox `/retrieve` + DataForSEO enrichment. |

Both routes require an authenticated user. The Mapbox session is owned by the **client** (UUIDv4 minted in `usePlaceSearch`); the server only relays it.

---

## Per-route detail

### `GET /api/search/suggest`

- **Source:** `src/app/api/search/suggest/route.ts`
- **Auth:** required.
- **Query params:**
  - `q` (string, required) — search text.
  - `session_token` (UUIDv4, required) — groups suggest+retrieve into one Mapbox billable session.
  - `proximity` (`<lng>,<lat>`, optional) — bias results near a viewport center.
- **DB:** none.
- **External:** `GET https://api.mapbox.com/search/searchbox/v1/suggest` via `src/lib/mapbox/search-box.ts#suggest`. Server token: `MAPBOX_SERVER_TOKEN` (falls back to `NEXT_PUBLIC_MAPBOX_TOKEN`).
- **Hard-coded:** `types=poi`, `language=en`, `limit=8`. POI-only — we are not adding cities/postcodes as places.
- **Response:** `{ suggestions: SearchSuggestion[] }`. Empty when `q` shorter than 2 chars (caller's responsibility) or when Mapbox returns nothing.
- **Cost tracking:** **none here.** The Mapbox session is billed once per `retrieve`; suggest calls within the same session token cost the same as 0 sessions.

### `GET /api/search/retrieve/[id]`

- **Source:** `src/app/api/search/retrieve/[id]/route.ts`
- **Auth:** required.
- **Path param:** `id` — Mapbox `mapbox_id` from a prior `/suggest` response.
- **Query params:**
  - `session_token` (UUIDv4, required) — must match the suggest call's token.
- **DB:** none.
- **External pipeline:**
  1. `src/lib/mapbox/search-box.ts#retrieve` → name + coords + address + POI categories.
  2. **`trackUsage(user.id, "mapbox_search_session")`** — one billable session per suggest→retrieve pair.
  3. If DataForSEO env credentials are configured: `fetchBusinessInfoLive({ keyword: name, location_coordinate: "lat,lng,200" })` for enrichment. On match: `trackUsage(user.id, "dataforseo_business_info_live")`.
- **Response shape (DataForSEO match):**

  ```ts
  {
    ...ParsedPlaceData,  // placeId (Google place_id or cid), name, address, country, city, lat, lng, types, photoRef, rating, openingHours, website, phone, priceLevel, googleMapsUrl
    _provider: "dataforseo",
    _mapbox_id: string,
    _fetchTimeMs: number,
    _extended: Partial<GooglePlaceData>,  // cid, rating_distribution, popular_times, attributes, business_description, ...
  }
  ```

- **Response shape (no DataForSEO match / no credentials):**

  ```ts
  {
    placeId: "",        // no Google ID → no dedup downstream
    name, address, country, city, lat, lng,
    types: poi_category[],
    photos: [], photoRef: null,
    rating: null, openingHours: null, priceLevel: null, googleMapsUrl: null,
    website, phone,    // from Mapbox metadata when present
    _provider: "mapbox",
    _mapbox_id: string,
    _fetchTimeMs: number,
  }
  ```

- **Status:** `200`; `400` (missing `session_token`); `401`; `404` (Mapbox returned no feature for the id).
- **Notes:**
  - Response mirrors `/api/places/parse-link` so the same UI form can save it.
  - **Dedup advantage** of DataForSEO path: returns `place_id` or `cid` → `POST /api/places` will reject duplicates via `idx_places_google_id`.
  - The Mapbox-only path stores `mapbox_id` under `google_data.mapbox_id` (opaque metadata) and falls back to manual-style insertion (no dedup).

## Cross-route concerns

- **Session token lifecycle (client-managed):** see [[../../03-frontend/hooks/use-place-search]]. The server is stateless w.r.t. tokens.
- **Cost-tracked SKUs touched:** `mapbox_search_session`, `dataforseo_business_info_live`.
- **No POST to `/api/places` here.** Save is performed by the frontend with the existing endpoint (`source: 'mapbox_search'`).

## Open questions

- **Mapbox `types`.** Currently `poi`-only. If a future need surfaces (e.g. saving a literal address), expand to `poi,address`.
- **Country/language bias.** Hard-coded `language=en`, no country filter. Add support if multi-language users join.
- **Background reviews enrichment.** Save flow can fire `POST /api/places/[id]/enrich?step=reviews` when DataForSEO returned a `cid` — done in `SearchResultPanel.handleSave`.
