/**
 * Parses various Google Maps URL formats to extract Place ID or coordinates.
 *
 * Supported formats:
 * - https://www.google.com/maps/place/...
 * - https://maps.app.goo.gl/xxx (short links)
 * - https://goo.gl/maps/xxx (old short links)
 * - https://www.google.com/maps?cid=xxx
 * - https://www.google.com/maps/search/...
 * - https://www.google.com/maps/@lat,lng,zoom
 */

export interface ParsedUrl {
  type: "place_id" | "cid" | "coordinates" | "search" | "unknown";
  placeId?: string;
  cid?: string;
  lat?: number;
  lng?: number;
  query?: string;
}

/**
 * Resolve short links and full Google Maps URLs by following redirects.
 * This gets us the final URL with coordinates.
 */
async function resolveUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
    });
    return response.url;
  } catch {
    try {
      const response = await fetch(url, { redirect: "follow" });
      return response.url;
    } catch {
      return url;
    }
  }
}

/**
 * Extract ChIJ-format Place ID from a full Google Maps URL.
 * Only returns ChIJ format IDs that work with the New Places API.
 */
function extractChIJPlaceId(url: string): string | null {
  // Format: ...data=!...!1sChIJ...
  const match = url.match(/!1s(ChIJ[a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Format: place_id=ChIJ...
  const paramMatch = url.match(/place_id=(ChIJ[^&]+)/);
  if (paramMatch) return decodeURIComponent(paramMatch[1]);

  return null;
}

/**
 * Check if URL contains an FTid (0x...:0x...) which is NOT compatible
 * with the New Places API but indicates a specific place.
 */
function hasFtid(url: string): boolean {
  return /!1s(0x[a-f0-9]+:0x[a-f0-9]+)/.test(url) ||
    /ftid=(0x[a-f0-9]+:0x[a-f0-9]+)/.test(url);
}

/**
 * Extract CID from URL.
 */
function extractCid(url: string): string | null {
  const cidMatch = url.match(/[?&]cid=(\d+)/);
  return cidMatch ? cidMatch[1] : null;
}

/**
 * Extract coordinates from URL.
 */
function extractCoordinates(url: string): { lat: number; lng: number } | null {
  // Format: @lat,lng,zoom
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Format: ll=lat,lng or center=lat,lng
  const llMatch = url.match(/(?:ll|center)=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (llMatch) {
    return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
  }

  // Format: /data=!3d(lat)!4d(lng)
  const dataMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (dataMatch) {
    return { lat: parseFloat(dataMatch[1]), lng: parseFloat(dataMatch[2]) };
  }

  return null;
}

/**
 * Extract search query from URL.
 */
function extractSearchQuery(url: string): string | null {
  // Format: /maps/search/query+text/
  const searchMatch = url.match(/\/maps\/search\/([^/@]+)/);
  if (searchMatch) return decodeURIComponent(searchMatch[1].replace(/\+/g, " "));

  // Format: /maps/place/Place+Name/
  const placeNameMatch = url.match(/\/maps\/place\/([^/@]+)/);
  if (placeNameMatch)
    return decodeURIComponent(placeNameMatch[1].replace(/\+/g, " "));

  // Format: q=query
  const qMatch = url.match(/[?&]q=([^&]+)/);
  if (qMatch) return decodeURIComponent(qMatch[1].replace(/\+/g, " "));

  return null;
}

/**
 * Main parser: takes any Google Maps URL and extracts structured data.
 */
export async function parseMapsUrl(rawUrl: string): Promise<ParsedUrl> {
  let url = rawUrl.trim();

  // Step 1: Resolve short links
  if (
    url.includes("goo.gl/maps/") ||
    url.includes("maps.app.goo.gl/") ||
    url.includes("maps.google.com/goo.gl")
  ) {
    url = await resolveUrl(url);
  }

  // Step 2: Try to extract ChIJ Place ID (works with New API)
  const placeId = extractChIJPlaceId(url);
  if (placeId) {
    const coords = extractCoordinates(url);
    return {
      type: "place_id",
      placeId,
      lat: coords?.lat,
      lng: coords?.lng,
    };
  }

  // Step 3: If URL has FTid (0x...) but no coordinates,
  // follow the URL to get the redirected version with coordinates
  if (hasFtid(url) && !extractCoordinates(url)) {
    const resolved = await resolveUrl(url);
    if (resolved !== url) {
      url = resolved;
      // Check if resolved URL now has a ChIJ Place ID
      const resolvedPlaceId = extractChIJPlaceId(url);
      if (resolvedPlaceId) {
        const coords = extractCoordinates(url);
        return {
          type: "place_id",
          placeId: resolvedPlaceId,
          lat: coords?.lat,
          lng: coords?.lng,
        };
      }
    }
  }

  // Step 4: Try CID
  const cid = extractCid(url);
  if (cid) {
    const coords = extractCoordinates(url);
    return {
      type: "cid",
      cid,
      lat: coords?.lat,
      lng: coords?.lng,
    };
  }

  // Step 5: Search URL with coordinates from FTid resolution or URL
  const query = extractSearchQuery(url);
  const coords = extractCoordinates(url);

  if (query) {
    return {
      type: "search",
      query,
      lat: coords?.lat,
      lng: coords?.lng,
    };
  }

  // Step 6: Just coordinates
  if (coords) {
    return {
      type: "coordinates",
      lat: coords.lat,
      lng: coords.lng,
    };
  }

  return { type: "unknown" };
}
