---
title: Mapbox
type: integration
domain: integrations
version: 1.1.0
last_updated: 13.05.2026
status: stable
sources:
  - src/components/map/map-view.tsx
  - src/lib/trip/directions.ts
  - src/lib/map/category-icons.ts
  - src/lib/mapbox/search-box.ts
  - src/app/api/search/suggest/route.ts
  - src/app/api/search/retrieve/[id]/route.ts
  - src/app/api/places/parse-link/route.ts
related:
  - "[[../03-frontend/components/map]]"
  - "[[../03-frontend/hooks/use-map-style]]"
  - "[[../01-domain/trips]]"
---

# Mapbox

Three products used: **Mapbox GL JS** for the map view, **Mapbox Directions API** for trip route lines, **Mapbox Search Box API** for in-app place search.

## Account & access

- **Provider:** Mapbox
- **Token type:** public access token (URL-restricted on the Mapbox side)
- **Allowed origins:** configured in Mapbox dashboard (must include localhost + production domain)

## NPM packages

| Package | Version | Role |
|---|---|---|
| `mapbox-gl` | `^3.23.1` | Map rendering |
| `@types/mapbox-gl` | `^3.5.0` | Types |

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | **public** | `MapView` initialization, Directions API calls from server (read from env on server route) |
| `MAPBOX_SERVER_TOKEN` | **server-only** | `src/lib/mapbox/search-box.ts` — Search Box API proxy. URL-restriction off. Falls back to `NEXT_PUBLIC_MAPBOX_TOKEN` if absent. |

Per-user override: `profiles.mapbox_token_enc` (encrypted column). If a user sets their own token in Settings → API, server-side code can use it. Browser-side always uses `NEXT_PUBLIC_MAPBOX_TOKEN` (the public token).

## What we use

### Mapbox GL JS (browser)

`src/components/map/map-view.tsx` — see [[../03-frontend/components/map#mapview]].

- Initializes a map with one of six styles (resolved by [[../03-frontend/hooks/use-map-style]]).
- GeoJSON source for places.
- Cluster + circle/symbol layers for markers.
- Optional line layer for trip routes (day-colored polylines).
- Popups on marker click.
- Viewport-change callback for the "visible places" badge.

Custom marker icons are rendered to canvas in `src/lib/map/category-icons.ts` and registered via `map.addImage()`. See [[../03-frontend/design-system/_README#custom-map-markers]].

### Directions API (server)

`src/lib/trip/directions.ts` exports `getRoute(coords, profile)` — a thin wrapper around:

```
GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}
```

- Default profile: walking (verify).
- Returns: `{ distance, duration, geometry, legs }` (distance in meters, duration in seconds).
- App converts to km/min and assigns to `TripDay.route`.

Called from:

- `GET /api/trips/[id]` — once per trip day with ≥ 2 places.
- `GET /api/shared/[slug]` when `resource_type = 'trip'` — same.

### Search Box API (server)

`src/lib/mapbox/search-box.ts` exports three thin fetch wrappers:

- `suggest({ q, sessionToken, proximity?, limit?, language? })` →  `GET https://api.mapbox.com/search/searchbox/v1/suggest`. Hard-codes `types=poi`. Returns autocomplete `SearchSuggestion[]`.
- `retrieve({ mapboxId, sessionToken, language? })` → `GET https://api.mapbox.com/search/searchbox/v1/retrieve/{id}`. Returns a single `RetrievedPlace` with coords, address, POI categories, brand, external IDs.
- `reverseGeocode({ lng, lat, language? })` → `GET https://api.mapbox.com/search/searchbox/v1/reverse`. Per-request endpoint. Used to pad DataForSEO keywords with address context when only `name + coords` are available (parse-link's `/maps/place/Name/@lat,lng/` branch).

Called from:

- `GET /api/search/suggest` — `/map` autocomplete (per keystroke after 300ms debounce).
- `GET /api/search/retrieve/[id]` — when the user picks a suggestion. Tracks one `mapbox_search_session` SKU per call.
- `POST /api/places/parse-link` — calls `reverseGeocode` for short-name Google Maps URLs to disambiguate DataForSEO search.

**Session model.** A `session_token` (UUIDv4 minted by the client in `usePlaceSearch`) groups all suggest calls plus one retrieve into a single billable session. The hook rotates the token after every successful retrieve or after 180s inactivity / 50 successive suggests. See [[../03-frontend/hooks/use-place-search]].

## Cost & limits

Mapbox public-key free tier:

- **Map loads:** 50,000 / month for GL JS.
- **Directions API:** 100,000 requests / month.
- **Search Box API (sessions):** 500 sessions / month free. Standard rate $11.50 / 1000 above the free tier.
- **Search Box API (per-request `/reverse`):** 50,000 / month free. `/category` not used today.

Directions calls are **not tracked** in `api_usage` (Mapbox dashboard only). **Search Box `retrieve` IS tracked** as `mapbox_search_session` for per-user cost visibility.

## Failure modes

- **Token revoked / wrong:** map fails to load; check console.
- **CORS / origin not allowed:** map fails; add domain in Mapbox dashboard.
- **Directions API 429:** rate-limited (very unlikely at our volume). The API route returns the route as `null` so the trip detail still renders (just without a route line).
- **Directions API 422:** invalid coordinates (e.g. one of them is `(0, 0)` — see [[../01-domain/geo-and-s2#open-questions]]).

## Dark-mode considerations

Mapbox popups don't honor the app's dark mode out of the box. The previous design system added a CSS override:

```css
.dark .mapboxgl-popup-content { background: #1a1a2e; color: #e2e8f0; }
.dark .mapboxgl-popup-tip   { border-top-color: #1a1a2e; }
```

Verify these are still in `src/app/globals.css`. If they were dropped, dark-mode popups would be white-on-white.

## Map style options

Six options in [[../03-frontend/hooks/use-map-style]]:

- `auto` (resolves to light or dark based on the active theme)
- `light-v11`
- `dark-v11`
- `streets-v12`
- `satellite-streets-v12`
- `outdoors-v12`

User preference persists in `localStorage["map-style"]`.

## Replacement strategy

If we swap Mapbox:

- **MapLibre GL** is a near drop-in for `mapbox-gl` (open-source fork). No token needed. Style URLs differ.
- **Google Maps JS** would be a heavier port — different API shape, different licensing model.
- **Directions** has fewer good alternatives (OpenRouteService, GraphHopper). Each requires its own auth and response shape.

Trip-route caching would soften the impact — see [[../02-backend/api-routes/trips#open-questions]].
