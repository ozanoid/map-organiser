/**
 * Parse PostGIS geography point from various formats (EWKB hex, WKT, GeoJSON, plain object).
 * Shared across all API routes.
 */
export function parsePostgisPoint(location: unknown): { lat: number; lng: number } {
  if (typeof location === "string") {
    // EWKB hex format (most common from Supabase geography columns)
    if (/^[0-9a-fA-F]+$/.test(location) && location.length > 20) {
      const parsed = parseEWKB(location);
      if (parsed) return parsed;
    }
    // WKT format
    const match = location.match(/POINT\((-?\d+\.?\d*)\s+(-?\d+\.?\d*)\)/);
    if (match) {
      return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
    // JSON string
    try {
      const geo = JSON.parse(location);
      if (geo.coordinates) return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
    } catch {}
  }

  if (typeof location === "object" && location !== null) {
    const loc = location as Record<string, unknown>;
    if ("lat" in loc && "lng" in loc) {
      return { lat: Number(loc.lat), lng: Number(loc.lng) };
    }
    if ("coordinates" in loc && Array.isArray(loc.coordinates)) {
      return { lng: loc.coordinates[0], lat: loc.coordinates[1] };
    }
  }

  return { lat: 0, lng: 0 };
}

function parseEWKB(hex: string): { lat: number; lng: number } | null {
  try {
    const buf = Buffer.from(hex, "hex");
    const le = buf[0] === 1;
    const lng = le ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
    const lat = le ? buf.readDoubleLE(17) : buf.readDoubleBE(17);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  } catch {}
  return null;
}
