/**
 * Parse Google Takeout GeoJSON export.
 * Takeout exports saved places as a GeoJSON FeatureCollection.
 */

export interface TakeoutPlace {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  googleMapsUrl: string | null;
  note: string | null;
}

export function parseTakeoutGeoJson(json: unknown): TakeoutPlace[] {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid GeoJSON file");
  }

  const geojson = json as {
    type?: string;
    features?: Array<{
      type?: string;
      geometry?: {
        type?: string;
        coordinates?: number[];
      };
      properties?: {
        Title?: string;
        "Google Maps URL"?: string;
        Location?: {
          Address?: string;
          "Geo Coordinates"?: {
            Latitude?: number;
            Longitude?: number;
          };
        };
        Published?: string;
        Updated?: string;
        Comment?: string;
      };
    }>;
  };

  if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    throw new Error("File is not a valid GeoJSON FeatureCollection");
  }

  return geojson.features
    .filter((f) => f.geometry?.type === "Point" && f.geometry.coordinates)
    .map((feature) => {
      const props = feature.properties || {};
      const coords = feature.geometry!.coordinates!;

      return {
        name: props.Title || "Unknown Place",
        address: props.Location?.Address || null,
        lat: coords[1], // GeoJSON is [lng, lat]
        lng: coords[0],
        googleMapsUrl: props["Google Maps URL"] || null,
        note: props.Comment || null,
      };
    });
}
