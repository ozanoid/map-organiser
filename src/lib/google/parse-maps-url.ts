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
 * Extract FTid (0x...:0x...) from URL. The first hex part is an S2 cell ID
 * that encodes the place's approximate location.
 */
function extractFtid(url: string): string | null {
  const match = url.match(/!1s(0x[a-f0-9]+:0x[a-f0-9]+)/) ||
    url.match(/ftid=(0x[a-f0-9]+:0x[a-f0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Decode approximate lat/lng from FTid's S2 cell ID.
 * The first hex part (before ':') is an S2 cell ID.
 */
function ftidToCoordinates(ftid: string): { lat: number; lng: number } | null {
  try {
    const hexPart = ftid.split(":")[0]; // e.g. "0x48761da571b3e74b"
    // Dynamic import would be better but we need sync here
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S2 } = require("s2-geometry");
    const cellId = BigInt(hexPart).toString();
    const latlng = S2.idToLatLng(cellId);
    if (latlng && isFinite(latlng.lat) && isFinite(latlng.lng)) {
      return { lat: latlng.lat, lng: latlng.lng };
    }
  } catch {
    // S2 decode failed
  }
  return null;
}

/**
 * Extract CID from URL — either from ?cid= param or from FTid's second hex part.
 * FTid format: 0x{s2_cell}:0x{cid_hex} — the second part IS the CID in hex.
 */
function extractCid(url: string): string | null {
  // Format: ?cid=12345 (decimal)
  const cidMatch = url.match(/[?&]cid=(\d+)/);
  if (cidMatch) return cidMatch[1];

  // Format: !1s0x...:0x{cid_hex} — convert hex to decimal
  const ftidMatch = url.match(/!1s0x[a-f0-9]+:(0x[a-f0-9]+)/) ||
    url.match(/ftid=0x[a-f0-9]+:(0x[a-f0-9]+)/);
  if (ftidMatch) {
    try {
      return BigInt(ftidMatch[1]).toString();
    } catch {
      // BigInt parse failed
    }
  }

  return null;
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

  // Step 3: Try CID — from ?cid= param OR from FTid's second hex part
  // This must come before the FTid fallback-to-search logic
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
