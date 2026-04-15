"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Place, Category } from "@/lib/types";
import { registerCategoryIcons } from "@/lib/map/category-icons";

interface MapViewProps {
  places: Place[];
  categories?: Category[];
  onPlaceClick?: (place: Place) => void;
  mapboxToken?: string;
  mapStyle?: string;
  className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  default: "#059669",
};

export function MapView({ places, categories = [], onPlaceClick, mapboxToken, mapStyle, className }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const layersAdded = useRef(false);

  // Keep refs stable for Mapbox event handlers
  const placesRef = useRef(places);
  const onPlaceClickRef = useRef(onPlaceClick);
  placesRef.current = places;
  onPlaceClickRef.current = onPlaceClick;

  const defaultStyle = mapStyle || "mapbox://styles/mapbox/light-v11";

  // Build GeoJSON from places
  const buildGeoJSON = useCallback((data: Place[]): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: data.map((place) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [place.location.lng, place.location.lat],
      },
      properties: {
        id: place.id,
        name: place.name,
        address: place.address || "",
        rating: place.rating,
        categoryColor: place.category?.color || CATEGORY_COLORS.default,
        categoryIcon: place.category?.icon || "map-pin",
        visitStatus: place.visit_status || "",
        googleUrl: place.google_data?.url || "",
      },
    })),
  }), []);

  // Keep categories ref for icon registration
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  // Add source + layers to the map
  const setupLayers = useCallback((m: mapboxgl.Map, geojson: GeoJSON.FeatureCollection) => {
    const sourceId = "places";

    // Register category icons before adding layers
    registerCategoryIcons(
      m,
      categoriesRef.current.map((c) => ({ icon: c.icon, color: c.color }))
    );

    if (m.getSource(sourceId)) {
      (m.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
      return;
    }

    m.addSource(sourceId, {
      type: "geojson",
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    // Cluster circles
    m.addLayer({
      id: "clusters",
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#059669",
        "circle-radius": [
          "step",
          ["get", "point_count"],
          18, 10, 24, 50, 30,
        ],
        "circle-opacity": 0.85,
      },
    });

    // Cluster count text
    m.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 13,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    // Individual markers — symbol layer with category icons
    m.addLayer({
      id: "unclustered-point",
      type: "symbol",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["concat", "cat-", ["get", "categoryIcon"]],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-anchor": "center",
      },
    });

    // Click on cluster → zoom in
    m.on("click", "clusters", (e) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0].properties?.cluster_id;
      (m.getSource(sourceId) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !zoom) return;
        const geometry = features[0].geometry;
        if (geometry.type === "Point") {
          m.easeTo({ center: geometry.coordinates as [number, number], zoom });
        }
      });
    });

    // Click on marker → show popup
    m.on("click", "unclustered-point", (e) => {
      if (!e.features?.[0]) return;
      const props = e.features[0].properties!;
      const geometry = e.features[0].geometry;
      if (geometry.type !== "Point") return;

      const coordinates = geometry.coordinates.slice() as [number, number];
      const ratingStars = props.rating
        ? "\u2605".repeat(props.rating) + "\u2606".repeat(5 - props.rating)
        : "";

      const visitStatusLabels: Record<string, { label: string; color: string }> = {
        want_to_go: { label: "Want to Go", color: "#F59E0B" },
        booked: { label: "Booked", color: "#3B82F6" },
        visited: { label: "Visited", color: "#22C55E" },
        favorite: { label: "Favorite", color: "#EF4444" },
      };
      const statusInfo = props.visitStatus ? visitStatusLabels[props.visitStatus] : null;

      const isDark = document.documentElement.classList.contains("dark");
      const textColor = isDark ? "#e2e8f0" : "#0f172a";
      const mutedColor = isDark ? "#94a3b8" : "#666666";

      const popupEl = document.createElement("article");
      popupEl.setAttribute("role", "dialog");
      popupEl.setAttribute("aria-label", `Place: ${props.name}`);
      popupEl.style.fontFamily = "Inter, sans-serif";
      popupEl.innerHTML = `
        <p style="font-weight:600;font-size:14px;margin:0 0 4px;color:${textColor}">${props.name}</p>
        ${props.address ? `<p style="font-size:12px;color:${mutedColor};margin:0 0 4px">${props.address}</p>` : ""}
        ${ratingStars ? `<p style="font-size:12px;color:#F97316;margin:0 0 4px" aria-label="Rating: ${props.rating} out of 5">${ratingStars}</p>` : ""}
        ${statusInfo ? `<p style="font-size:11px;color:${statusInfo.color};font-weight:500;margin:0 0 4px">${statusInfo.label}</p>` : ""}
        <div style="display:flex;gap:12px;margin-top:6px;align-items:center">
          <button type="button" class="popup-details" style="font-size:12px;color:#059669;font-weight:500;cursor:pointer;background:none;border:none;padding:6px 2px;margin:-6px -2px;min-height:44px;display:flex;align-items:center" aria-label="View details for ${props.name}">View details \u2192</button>
          ${props.googleUrl ? `<a href="${props.googleUrl}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#3B82F6;text-decoration:none;font-weight:500;padding:6px 2px;min-height:44px;display:flex;align-items:center" onclick="event.stopPropagation()" aria-label="Open ${props.name} in Google Maps">Maps \u2197</a>` : ""}
        </div>
      `;

      const detailsBtn = popupEl.querySelector(".popup-details");
      if (detailsBtn) {
        detailsBtn.addEventListener("click", () => {
          const place = placesRef.current.find((p) => p.id === props.id);
          if (place && onPlaceClickRef.current) onPlaceClickRef.current(place);
        });
      }

      new mapboxgl.Popup({ offset: 12, closeButton: false, maxWidth: "260px" })
        .setLngLat(coordinates)
        .setDOMContent(popupEl)
        .addTo(m);
    });

    // Cursor pointer on hover
    m.on("mouseenter", "clusters", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", "clusters", () => { m.getCanvas().style.cursor = ""; });
    m.on("mouseenter", "unclustered-point", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", "unclustered-point", () => { m.getCanvas().style.cursor = ""; });

    layersAdded.current = true;
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = mapboxToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: defaultStyle,
      center: [29.0, 41.0],
      zoom: 5,
      attributionControl: false,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }),
      "top-right"
    );

    map.current.on("load", () => setMapLoaded(true));

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Handle style changes (dark/light/manual switch)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const currentStyle = map.current.getStyle()?.sprite;
    // Only switch if the style actually changed
    if (defaultStyle && currentStyle && !currentStyle.toString().includes(defaultStyle.replace("mapbox://styles/mapbox/", ""))) {
      layersAdded.current = false;
      map.current.setStyle(defaultStyle);

      map.current.once("style.load", () => {
        const geojson = buildGeoJSON(placesRef.current);
        setupLayers(map.current!, geojson);
      });
    }
  }, [defaultStyle, mapLoaded, buildGeoJSON, setupLayers]);

  // Update markers when places change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const geojson = buildGeoJSON(places);

    if (layersAdded.current && map.current.getSource("places")) {
      (map.current.getSource("places") as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      setupLayers(map.current, geojson);
    }
  }, [places, mapLoaded, buildGeoJSON, setupLayers]);

  // Fit bounds when places change
  useEffect(() => {
    if (!map.current || !mapLoaded || places.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    places.forEach((p) => bounds.extend([p.location.lng, p.location.lat]));

    if (places.length === 1) {
      map.current.flyTo({ center: bounds.getCenter(), zoom: 14 });
    } else {
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    }
  }, [places, mapLoaded]);

  return (
    <div
      ref={mapContainer}
      className={className || "w-full h-full"}
    />
  );
}
