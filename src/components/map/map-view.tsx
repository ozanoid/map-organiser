"use client";

import { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Place } from "@/lib/types";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

interface MapViewProps {
  places: Place[];
  onPlaceClick?: (place: Place) => void;
  className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  default: "#059669",
};

export function MapView({ places, onPlaceClick, className }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

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

      // Individual markers
      map.current.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: sourceId,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "categoryColor"],
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
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

        new mapboxgl.Popup({ offset: 12, closeButton: false, maxWidth: "240px" })
          .setLngLat(coordinates)
          .setHTML(
            `<div style="font-family:Inter,sans-serif">
              <p style="font-weight:600;font-size:14px;margin:0 0 4px">${props.name}</p>
              ${props.address ? `<p style="font-size:12px;color:#666;margin:0 0 4px">${props.address}</p>` : ""}
              ${ratingStars ? `<p style="font-size:12px;color:#F97316;margin:0">${ratingStars}</p>` : ""}
            </div>`
          )
          .addTo(map.current!);

        if (onPlaceClick) {
          const place = places.find((p) => p.id === props.id);
          if (place) onPlaceClick(place);
        }
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
