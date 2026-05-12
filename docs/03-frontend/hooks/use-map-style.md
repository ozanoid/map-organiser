---
title: useMapStyle
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-map-style.ts
related:
  - "[[_README]]"
  - "[[../design-system/_README]]"
  - "[[../components/map]]"
---

# `useMapStyle`

Reads + writes user preferences for the Mapbox style and marker style. Backed by `localStorage`. Theme-aware ("auto" follows the active light/dark mode).

## Signature

```ts
function useMapStyle(): {
  mapStyle: MapStyleKey;
  setMapStyle: (style: MapStyleKey) => void;
  mapStyleUrl: string;
  markerStyle: MarkerStyle;
  setMarkerStyle: (style: MarkerStyle) => void;
}

type MapStyleKey =
  | "auto"
  | "light-v11"
  | "dark-v11"
  | "streets-v12"
  | "satellite-streets-v12"
  | "outdoors-v12";

type MarkerStyle = "icons" | "dots";
```

## Behavior

- Reads `localStorage["map-style"]` and `localStorage["marker-style"]` on mount.
- Defaults: `mapStyle = "auto"`, `markerStyle = "icons"`.
- `mapStyleUrl` resolves to a full `mapbox://styles/mapbox/...` URL based on `mapStyle` and (when `"auto"`) the current `resolvedTheme` from `next-themes`.
- `setMapStyle` / `setMarkerStyle` write to `localStorage` and trigger a re-render.

## Style resolution table

| `mapStyle` value | `resolvedTheme` | URL |
|---|---|---|
| `"auto"` | `light` | `mapbox://styles/mapbox/light-v11` |
| `"auto"` | `dark` | `mapbox://styles/mapbox/dark-v11` |
| `"light-v11"` | any | `mapbox://styles/mapbox/light-v11` |
| `"dark-v11"` | any | `mapbox://styles/mapbox/dark-v11` |
| `"streets-v12"` | any | `mapbox://styles/mapbox/streets-v12` |
| `"satellite-streets-v12"` | any | `mapbox://styles/mapbox/satellite-streets-v12` |
| `"outdoors-v12"` | any | `mapbox://styles/mapbox/outdoors-v12` |

## Dependencies

- `useTheme` from `next-themes`.

## Consumers

- `src/app/(app)/map/page.tsx`
- `src/app/(app)/settings/page.tsx` (Theme tab)
- `src/components/map/map-content.tsx`
- `src/components/filters/filter-sheet.tsx`

## Edge cases

- **Hydration:** initial render uses the default values; after mount, the hook reads from `localStorage` and re-renders. The map view should be ready to handle a style change shortly after first paint.
- **Theme change while `"auto"`:** `mapStyleUrl` recomputes; the consuming map component must call `map.setStyle()` and re-apply custom layers on `style.load`.
