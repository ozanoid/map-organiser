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
 * Resolve short links (goo.gl, maps.app.goo.gl) by following redirects server-side.
 */
async function resolveShortLink(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
    });
    return response.url;
  } catch {
    // If HEAD fails, try GET
    const response = await fetch(url, { redirect: "follow" });
    return response.url;
  }
}

/**
 * Extract Place ID from a full Google Maps URL.
 */
function extractPlaceId(url: string): string | null {
  // Format: ...data=!...!1sChIJ... or !1s0x...:0x...
  const placeIdMatch = url.match(/!1s(ChIJ[a-zA-Z0-9_-]+)/);
  if (placeIdMatch) return placeIdMatch[1];

  // Format: place_id=ChIJ...
  const paramMatch = url.match(/place_id=([^&]+)/);
  if (paramMatch) return decodeURIComponent(paramMatch[1]);

  // Format: /maps/place/.../@lat,lng/data=...!3m1!4b1!...
  // Sometimes the ftid contains it
  const ftidMatch = url.match(/ftid=(0x[a-f0-9]+:0x[a-f0-9]+)/);
  if (ftidMatch) return ftidMatch[1];

  return null;
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
    url = await resolveShortLink(url);
  }

  // Step 2: Try to extract Place ID
  const placeId = extractPlaceId(url);
  if (placeId) {
    const coords = extractCoordinates(url);
    return {
      type: "place_id",
      placeId,
      lat: coords?.lat,
      lng: coords?.lng,
    };
  }

  // Step 3: Try CID
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

  // Step 4: Search URL
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

  // Step 5: Just coordinates
  if (coords) {
    return {
      type: "coordinates",
      lat: coords.lat,
      lng: coords.lng,
    };
  }

  return { type: "unknown" };
}
