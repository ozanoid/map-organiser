---
title: S2 Geometry
type: integration
domain: integrations
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/google/parse-maps-url.ts
  - package.json
related:
  - "[[../01-domain/geo-and-s2]]"
  - "[[google-places]]"
---

# S2 Geometry

Google's hierarchical spatial indexing library. Used in exactly **one** place in this repo: decoding the FTid embedded in Google Maps URLs into approximate coordinates.

## NPM package

- `s2-geometry` `^1.2.10`

## Where it's used

Only in `src/lib/google/parse-maps-url.ts`:

```ts
const { S2 } = require("s2-geometry");
// hex string → S2 cell ID → lat/lng center
```

Lazy-required so the dependency doesn't bloat client bundles.

## What it decodes

Google Maps URLs of the form:

```
.../data=...!16s%2Fg%2F11..._<HEX1>:<HEX2>_
```

The `<HEX1>` portion is an S2 cell ID at some level (typically 16–20). Decoding gives the **center of that cell**, which is within 10–100 meters of the actual place location.

This is **fallback** — the parser tries explicit `@lat,lng,zoom` in the URL first. S2 decoding kicks in only when explicit coords aren't present.

## Why S2 specifically

Google's FTids encode S2 cell IDs (not H3, not Geohash). Using any other library wouldn't decode them.

## Failure modes

- **Decode throws:** the parser catches and falls back. If everything else fails, `location` may be `(0, 0)` — see [[../01-domain/geo-and-s2#failure-mode]].
- **Wrong cell level:** the decode would return an imprecise location, but still inside the right region. The enrichment step (Google Places or DataForSEO) corrects it.

## Replacement strategy

If we drop the S2 fallback:

- Some Google Maps URL formats would parse to `(0, 0)` more often.
- We'd need a stronger guard in the import flow to reject `(0, 0)` places.

S2 stays scoped to one tiny fallback. If we ever broaden spatial features (regional aggregation, cluster IDs), revisit whether S2 should be promoted.

## Open questions

- **Bundle impact verification.** Lazy `require` keeps it server-only, but worth confirming nothing accidentally imports it from a Client Component.
- **PostGIS alternative.** For server-side spatial work, PostGIS handles everything. S2 is only relevant for parsing Google's encoded IDs.
