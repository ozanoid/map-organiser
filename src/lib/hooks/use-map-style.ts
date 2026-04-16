"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";

const MAP_STYLES: Record<string, string> = {
  "light-v11": "mapbox://styles/mapbox/light-v11",
  "dark-v11": "mapbox://styles/mapbox/dark-v11",
  "streets-v12": "mapbox://styles/mapbox/streets-v12",
  "satellite-streets-v12": "mapbox://styles/mapbox/satellite-streets-v12",
  "outdoors-v12": "mapbox://styles/mapbox/outdoors-v12",
};

const STORAGE_KEY = "map-style";
const MARKER_STYLE_KEY = "marker-style";

export type MarkerStyle = "icons" | "dots";

export type MapStyleKey = "auto" | keyof typeof MAP_STYLES;

export const MAP_STYLE_OPTIONS = [
  { value: "auto", label: "Auto (theme)", description: "Follows light/dark theme" },
  { value: "streets-v12", label: "Streets", description: "Detailed street map" },
  { value: "satellite-streets-v12", label: "Satellite", description: "Satellite imagery" },
  { value: "outdoors-v12", label: "Outdoors", description: "Nature & hiking" },
  { value: "light-v11", label: "Light", description: "Minimal, clean" },
  { value: "dark-v11", label: "Dark", description: "Dark map" },
] as const;

export function useMapStyle() {
  const { resolvedTheme } = useTheme();
  const [mapStyle, setMapStyleState] = useState<MapStyleKey>("auto");
  const [markerStyle, setMarkerStyleState] = useState<MarkerStyle>("icons");

  // Read from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === "auto" || stored in MAP_STYLES)) {
      setMapStyleState(stored as MapStyleKey);
    }
    const storedMarker = localStorage.getItem(MARKER_STYLE_KEY);
    if (storedMarker === "icons" || storedMarker === "dots") {
      setMarkerStyleState(storedMarker);
    }
  }, []);

  const setMapStyle = useCallback((style: MapStyleKey) => {
    setMapStyleState(style);
    localStorage.setItem(STORAGE_KEY, style);
  }, []);

  const setMarkerStyle = useCallback((style: MarkerStyle) => {
    setMarkerStyleState(style);
    localStorage.setItem(MARKER_STYLE_KEY, style);
  }, []);

  // Resolve the actual Mapbox style URL
  const mapStyleUrl =
    mapStyle === "auto"
      ? MAP_STYLES[resolvedTheme === "dark" ? "dark-v11" : "light-v11"]
      : MAP_STYLES[mapStyle] || MAP_STYLES["light-v11"];

  return { mapStyle, setMapStyle, mapStyleUrl, markerStyle, setMarkerStyle };
}
