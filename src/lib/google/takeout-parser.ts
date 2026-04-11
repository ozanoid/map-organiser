/**
 * Parse Google Takeout exports (GeoJSON or CSV).
 */

export interface TakeoutPlace {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  googleMapsUrl: string | null;
  note: string | null;
}

/**
 * Parse Google Takeout CSV export.
 * CSV has columns: Title, Note, URL, Tags, Comment
 * URL contains Google Maps place links with embedded Place IDs.
 */
export function parseTakeoutCsv(csvText: string): TakeoutPlace[] {
  const lines = csvText.split("\n");
  if (lines.length < 2) throw new Error("CSV file is empty or has no data rows");

  // Parse header
  const header = parseCsvLine(lines[0]);
  const titleIdx = header.findIndex((h) => h.toLowerCase() === "title");
  const noteIdx = header.findIndex((h) => h.toLowerCase() === "note");
  const urlIdx = header.findIndex((h) => h.toLowerCase() === "url");
  const commentIdx = header.findIndex((h) => h.toLowerCase() === "comment");

  if (titleIdx === -1 || urlIdx === -1) {
    throw new Error("CSV must have at least 'Title' and 'URL' columns");
  }

  const places: TakeoutPlace[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    const title = cols[titleIdx]?.trim();
    const url = cols[urlIdx]?.trim();
    const note = cols[noteIdx]?.trim() || cols[commentIdx]?.trim() || null;

    if (!title || !url) continue;

    // Extract coordinates from URL if present (@lat,lng pattern)
    const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);

    places.push({
      name: title,
      address: null,
      lat: coordMatch ? parseFloat(coordMatch[1]) : 0,
      lng: coordMatch ? parseFloat(coordMatch[2]) : 0,
      googleMapsUrl: url,
      note,
    });
  }

  return places;
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
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
