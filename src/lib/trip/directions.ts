interface RouteResult {
  distance_km: number;
  duration_min: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  legs: Array<{ distance_km: number; duration_min: number }>;
}

/**
 * Get walking/driving route between ordered coordinates via Mapbox Directions API.
 * Requires at least 2 coordinates.
 */
export async function getRoute(
  coordinates: [number, number][], // [lng, lat] pairs
  profile: "walking" | "driving" = "walking",
  token?: string
): Promise<RouteResult | null> {
  if (coordinates.length < 2) return null;

  const accessToken = token || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (!accessToken) return null;

  // Mapbox Directions API: max 25 waypoints
  const coords = coordinates.slice(0, 25);
  const coordString = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");

  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordString}?geometries=geojson&overview=full&steps=false&access_token=${accessToken}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    return {
      distance_km: Math.round((route.distance / 1000) * 10) / 10,
      duration_min: Math.round(route.duration / 60),
      geometry: route.geometry,
      legs: (route.legs || []).map((leg: { distance: number; duration: number }) => ({
        distance_km: Math.round((leg.distance / 1000) * 10) / 10,
        duration_min: Math.round(leg.duration / 60),
      })),
    };
  } catch {
    return null;
  }
}
