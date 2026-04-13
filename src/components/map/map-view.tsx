"use client";

import { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Place } from "@/lib/types";

interface MapViewProps {
  places: Place[];
  onPlaceClick?: (place: Place) => void;
  mapboxToken?: string;
  className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  default: "#059669",
};

export function MapView({ places, onPlaceClick, mapboxToken, className }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Keep refs stable for Mapbox event handlers
  const placesRef = useRef(places);
  const onPlaceClickRef = useRef(onPlaceClick);
  placesRef.current = places;
  onPlaceClickRef.current = onPlaceClick;

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = mapboxToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [29.0, 41.0], // Istanbul default
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

  // Update markers when places change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: places.map((place) => ({
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
    };

    const sourceId = "places";

    if (map.current.getSource(sourceId)) {
      (map.current.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(
        geojson
      );
    } else {
      map.current.addSource(sourceId, {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.current.addLayer({
        id: "clusters",
        type: "circle",
        source: sourceId,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#059669",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            24,
            50,
            30,
          ],
          "circle-opacity": 0.85,
        },
      });

      // Cluster count text
      map.current.addLayer({
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

      // Individual markers with visit status differentiation
      map.current.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: sourceId,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "categoryColor"],
          "circle-radius": 8,
          "circle-stroke-width": [
            "match",
            ["get", "visitStatus"],
            "visited", 3,
            "favorite", 3,
            "booked", 3,
            "want_to_go", 2.5,
            2,
          ],
          "circle-stroke-color": [
            "match",
            ["get", "visitStatus"],
            "visited", "#22C55E",
            "favorite", "#EF4444",
            "booked", "#3B82F6",
            "want_to_go", "#F59E0B",
            "#ffffff",
          ],
        },
      });

      // Click on cluster → zoom in
      map.current.on("click", "clusters", (e) => {
        const features = map.current!.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        });
        const clusterId = features[0].properties?.cluster_id;
        (
          map.current!.getSource(sourceId) as mapboxgl.GeoJSONSource
        ).getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || !zoom) return;
          const geometry = features[0].geometry;
          if (geometry.type === "Point") {
            map.current!.easeTo({
              center: geometry.coordinates as [number, number],
              zoom,
            });
          }
        });
      });

      // Click on marker → show popup
      map.current.on("click", "unclustered-point", (e) => {
        if (!e.features?.[0]) return;
        const props = e.features[0].properties!;
        const geometry = e.features[0].geometry;
        if (geometry.type !== "Point") return;

        const coordinates = geometry.coordinates.slice() as [number, number];

        const ratingStars = props.rating
          ? "★".repeat(props.rating) + "☆".repeat(5 - props.rating)
          : "";

        const visitStatusLabels: Record<string, { label: string; color: string }> = {
          want_to_go: { label: "Want to Go", color: "#F59E0B" },
          booked: { label: "Booked", color: "#3B82F6" },
          visited: { label: "Visited", color: "#22C55E" },
          favorite: { label: "Favorite", color: "#EF4444" },
        };
        const statusInfo = props.visitStatus ? visitStatusLabels[props.visitStatus] : null;

        const popupEl = document.createElement("div");
        popupEl.style.fontFamily = "Inter, sans-serif";
        popupEl.innerHTML = `
          <p style="font-weight:600;font-size:14px;margin:0 0 4px">${props.name}</p>
          ${props.address ? `<p style="font-size:12px;color:#666;margin:0 0 4px">${props.address}</p>` : ""}
          ${ratingStars ? `<p style="font-size:12px;color:#F97316;margin:0 0 4px">${ratingStars}</p>` : ""}
          ${statusInfo ? `<p style="font-size:11px;color:${statusInfo.color};font-weight:500;margin:0 0 4px">${statusInfo.label}</p>` : ""}
          <div style="display:flex;gap:12px;margin-top:6px;align-items:center">
            <span class="popup-details" style="font-size:11px;color:#059669;font-weight:500;cursor:pointer">View details →</span>
            ${props.googleUrl ? `<a href="${props.googleUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#3B82F6;text-decoration:none;font-weight:500" onclick="event.stopPropagation()">Maps ↗</a>` : ""}
          </div>
        `;

        // "View details" click → trigger onPlaceClick (no navigation)
        const detailsLink = popupEl.querySelector(".popup-details");
        if (detailsLink) {
          detailsLink.addEventListener("click", () => {
            const place = placesRef.current.find((p) => p.id === props.id);
            if (place && onPlaceClickRef.current) onPlaceClickRef.current(place);
          });
        }

        new mapboxgl.Popup({ offset: 12, closeButton: false, maxWidth: "260px" })
          .setLngLat(coordinates)
          .setDOMContent(popupEl)
          .addTo(map.current!);
      });

      // Cursor pointer on hover
      map.current.on("mouseenter", "clusters", () => {
        if (map.current) map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "clusters", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
      });
      map.current.on("mouseenter", "unclustered-point", () => {
        if (map.current) map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "unclustered-point", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
      });
    }
  }, [places, mapLoaded, onPlaceClick]);

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
