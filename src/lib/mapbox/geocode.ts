import "server-only";

/**
 * Mapbox Geocoding v6 forward lookup for an area the user names
 * ("Shoreditch, London"). Used by the assistant's search tools to turn a
 * neighbourhood into a point. Billed per request (SKU mapbox_geocoding);
 * the caller tracks usage.
 */

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";

function getToken(): string {
  // Server-only token preferred; the public one is URL-restricted in
  // production and may be refused without a browser Referer.
  return process.env.MAPBOX_SERVER_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
}

export interface GeocodedArea {
  label: string;
  lat: number;
  lng: number;
}

export async function geocodeArea(query: string): Promise<GeocodedArea | null> {
  const token = getToken();
  if (!token) return null;
  const params = new URLSearchParams({
    q: query,
    access_token: token,
    limit: "1",
    language: "en",
    types: "neighborhood,locality,district,place,postcode,street,address",
  });
  try {
    const res = await fetch(`${GEOCODE_URL}?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[mapbox/geocode] ${res.status} ${res.statusText}`);
      return null;
    }
    const json = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { full_address?: string; name?: string };
      }>;
    };
    const f = json.features?.[0];
    const c = f?.geometry?.coordinates;
    if (!c || c.length < 2) return null;
    return { label: f?.properties?.full_address ?? f?.properties?.name ?? query, lng: c[0], lat: c[1] };
  } catch (e) {
    console.warn("[mapbox/geocode] request failed", e);
    return null;
  }
}
