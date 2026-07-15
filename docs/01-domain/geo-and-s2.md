---
title: Geo & S2
type: entity
domain: geo
version: 1.1.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/geo.ts
  - src/lib/google/parse-maps-url.ts
  - src/lib/trip/directions.ts
  - src/components/map/map-view.tsx
  - src/components/map/map-content.tsx
related:
  - "[[places]]"
  - "[[trips]]"
  - "[[../02-backend/schema/places]]"
  - "[[../04-integrations/mapbox]]"
---

# Geo & S2

How spatial data flows in this app. Three concerns live here:

1. **PostGIS** — the storage and indexing layer for place coordinates.
2. **The geo parser** (`src/lib/geo.ts`) — the single place that converts PostGIS wire formats into `{lat, lng}` for the app.
3. **S2 geometry** — used only as a fallback to decode Google Maps URLs that lack explicit coordinates.

## PostGIS

PostGIS is installed in the `public` schema (advisor flags this as a warn but doesn't break anything). Version: `3.3.7`.

### Where geography is used

- **`places.location`** — column type `geography(Point, 4326)`. Stores the coordinates of every place. WGS84 spheroid.
- **`idx_places_location`** — GIST index on `places.location`. Enables fast `ST_DWithin` and friends.

No other table currently uses PostGIS types. (Trip routes are computed on read from Mapbox and not persisted as geometry.)

### Why `geography` (not `geometry`)

`geography` uses the WGS84 spheroid; distances and within-checks come out in meters on the Earth's surface. `geometry` is planar — fast, but you need a projection for distances to be meaningful. The places-app pattern (Earth-scale points, distance queries) is exactly what `geography` is for.

### Wire formats coming back from Supabase

When the app `SELECT`s a row containing `location`, the value can come back in any of the following shapes depending on the client and the query:

| Format | Example | When it shows up |
|---|---|---|
| **EWKB hex** | `"0101000020E6100000..."` | Default for the Supabase JS client over PostgREST. |
| **WKT** | `"POINT(-0.0747 51.5395)"` | Some PostGIS functions return text. |
| **GeoJSON** | `{"type":"Point","coordinates":[-0.0747,51.5395]}` | When the query explicitly wraps in `ST_AsGeoJSON`. |
| **Plain `{ lat, lng }`** | `{ lat: 51.5395, lng: -0.0747 }` | Internal: after the parser, or in TypeScript types. |

The TypeScript `Place.location` field is always `{ lat: number, lng: number }` — but only **after** going through the parser.

## The shared parser — `src/lib/geo.ts`

```ts
export function parsePostgisPoint(location: unknown): { lat: number; lng: number }
```

One function, all formats. Every API route that reads `places.location` runs it through this parser before serializing. It accepts:

- **EWKB hex string** (long hex, even length, `len > 20`) → byte-reads the lat/lng (handles little-endian and big-endian).
- **WKT string** matching `POINT(lng lat)` → regex extract.
- **JSON-encoded GeoJSON string** (`'{"coordinates":[lng,lat]}'`) → `JSON.parse` then extract.
- **`{ lat, lng }` object** → pass through.
- **`{ coordinates: [lng, lat] }` object** → swap to `{ lat, lng }`.
- **Anything else** → returns `{ lat: 0, lng: 0 }` (silent fallback — be aware).

### EWKB byte layout

For Point geographies, the EWKB layout is:

| Bytes | Meaning |
|---|---|
| `0` | Byte order (`01` = little-endian, `00` = big-endian) |
| `1–4` | Type code (point with SRID flag) |
| `5–8` | SRID (typically `4326`) |
| `9–16` | X coordinate (longitude), 8-byte double |
| `17–24` | Y coordinate (latitude), 8-byte double |

The parser only reads bytes 9–16 (lng) and 17–24 (lat) — it doesn't validate the type code or SRID.

### Importing the parser

Any route that touches geography points imports it:

```ts
import { parsePostgisPoint } from "@/lib/geo";
```

> **Conventions:** never re-implement EWKB parsing inline. If a new shape needs handling, extend `parsePostgisPoint` and update this doc.

## Distance queries

The repo doesn't currently issue `ST_DWithin` or similar from the frontend. Distance comes up in two places, both client-side after data is loaded:

- **Auto-plan** (`src/lib/trip/auto-plan.ts`) — haversine on `{lat, lng}` for the nearest-neighbor heuristic and for k-means cluster assignment. (v1.19.0: `haversineDistance` itself moved to `src/lib/geo.ts` — shared with the compare view's distance column; auto-plan imports it.)
- **Mapbox Directions** — Mapbox returns segment distance and duration in the response; the app surfaces those without recomputing.

If a future feature needs "places within N km", that would be the first DB-side spatial query. `idx_places_location` is already in place to support it.

## Where coordinates come from

For inbound Places, coordinates are filled by:

1. **Google Places lookup** — returns explicit `lat`/`lng`.
2. **DataForSEO Business Data** — returns explicit `lat`/`lng`.
3. **Google Maps URL parser** (`src/lib/google/parse-maps-url.ts`) — when the user pastes a `/maps/place/...` URL, we try in order:
   - **Explicit coordinates** in the URL path (`@lat,lng,zoom`).
   - **FTid decode** as a fallback (see next section).

## S2 geometry — Google FTid decoding

The `s2-geometry` npm package (^1.2.10) is used **only** in `src/lib/google/parse-maps-url.ts` to decode Google's FTid into approximate coordinates.

### FTid carries two payloads

A Google FTid is the form **`0xCELL:0xCID`**:

1. **First hex (`0xCELL`)** — an S2 cell ID, decodable to approximate coords (the historical fallback).
2. **Second hex (`0xCID`)** — the Google **CID** for the business. `BigInt("0x...").toString()` gives a decimal CID that DataForSEO accepts as `keyword: cid:<decimal>` for exact-match Business Info lookups.

The parser now prefers the CID path (`type: "cid"`) and falls back to S2 decoding only when CID extraction fails. This is what makes short-link shares like `https://maps.app.goo.gl/...` resolve reliably even when their viewport center sits a kilometer away from the actual POI.

### What's an FTid?

When a Google Maps URL doesn't carry `@lat,lng,zoom`, it often carries an FTid:

```
.../data=!3m1!4b1!4m...!8m2!3d51.5395!4d-0.0747!16s%2Fg%2F11..._FTID_HEX1:FTID_HEX2_
```

The `FTID_HEX1:FTID_HEX2` pair is two hex numbers. The **first** hex is an S2 cell ID (Google's hierarchical spatial cell scheme); the **second** is an opaque feature index within that cell.

### What the decode buys us

An S2 cell ID maps to a region on the Earth. Decoding it gives the **center of that cell** — not the exact place location, but usually within 10–100 meters of it. Good enough to:

- Seed a search radius for Places API.
- Display the place on the map until enrichment fills in the exact lat/lng.

### How it's done

```ts
const { S2 } = require("s2-geometry");
// hex → numeric → S2 cell → lat/lng
```

Lazy-required to avoid bloating the client bundle for a code path that runs server-side only.

### Failure mode

If the decode throws or the FTid is malformed, the parser falls back to whatever else it could glean from the URL. If nothing works, the place still gets created, but `location` may be `(0, 0)` — which is in the Atlantic Ocean off Africa. **`(0, 0)` is the sentinel for "we don't know"**; the UI doesn't currently surface this as an error, so it's worth filtering on import.

## Why S2 instead of a richer geometry library

The codebase explicitly does **not** use:

- **Turf.js** — overkill for the haversine + clustering we do.
- **h3-js (Uber)** — same idea as S2 but Google's URLs encode S2 specifically.
- **PostGIS for clustering** — k-means in JS is faster than a round-trip per cluster.

S2 stays scoped to the one decode path. If the app grows broader spatial features (regional aggregation, geo-fences), revisit.

## Map rendering

`src/components/map/map-view.tsx` and `map-content.tsx` consume `{lat, lng}` arrays directly. Mapbox handles projection internally. The map doesn't talk to PostGIS — it only consumes what the API returned.

## Open questions

- **`(0,0)` sentinels.** Worth a follow-up to flag any places with `location.lat === 0 && location.lng === 0` in the UI or filter them out by default.
- **Server-side spatial queries.** None today. When the first one lands (e.g. "places near me"), document the query patterns here.
- **PostGIS schema move.** Advisor recommends `postgis` extension live in a non-public schema. Currently in `public`. Low-priority but real.
