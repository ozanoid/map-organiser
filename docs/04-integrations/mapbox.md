---
title: Mapbox
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/components/map/map-view.tsx
  - src/lib/trip/directions.ts
  - src/lib/map/category-icons.ts
related:
  - "[[../03-frontend/components/map]]"
  - "[[../03-frontend/hooks/use-map-style]]"
  - "[[../01-domain/trips]]"
---

# Mapbox

Two products used: **Mapbox GL JS** for the map view, **Mapbox Directions API** for trip route lines.

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

## Cost & limits

Mapbox public-key free tier:

- **Map loads:** 50,000 / month for GL JS.
- **Directions API:** 100,000 requests / month.

Per the v2 design doc, current trip view uses ~1 Directions call per day with 2+ stops. Heavy usage would still be far below the free tier.

**Not tracked via `api_usage`** — Mapbox tracks calls on their dashboard.

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
