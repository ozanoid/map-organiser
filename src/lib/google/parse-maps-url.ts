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
  /** When the input was a short link, the URL it resolved to (for downstream re-inspection). */
  resolvedUrl?: string;
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
 * The second hex of an FTid (`0xCELL:0xCID`) is the Google CID — a stable
 * 64-bit handle that DataForSEO accepts as `cid:<decimal>` for exact-match
 * Business Info lookups. This converts that hex to decimal.
 */
function cidFromFtid(ftid: string): string | null {
  const parts = ftid.split(":");
  if (parts.length !== 2) return null;
  try {
    return BigInt(parts[1]).toString();
  } catch {
    return null;
  }
}

/**
 * Extract CID from URL query parameter only.
 */
function extractCid(url: string): string | null {
  const cidMatch = url.match(/[?&]cid=(\d+)/);
  return cidMatch ? cidMatch[1] : null;
}

/**
 * Extract coordinates from URL.
 *
 * Precedence matters: !3d!4d (POI's actual location inside Google's `data=`
 * payload) is correct; @lat,lng is the *viewport center* the user happened
 * to be looking at when they shared, and can sit a kilometer away from the
 * actual POI. Check !3d!4d first.
 */
function extractCoordinates(url: string): { lat: number; lng: number } | null {
  // Format: /data=!3d(lat)!4d(lng) — POI's actual coordinates (most accurate)
  const dataMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (dataMatch) {
    return { lat: parseFloat(dataMatch[1]), lng: parseFloat(dataMatch[2]) };
  }

  // Format: @lat,lng,zoom — viewport center, fallback
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Format: ll=lat,lng or center=lat,lng
  const llMatch = url.match(/(?:ll|center)=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (llMatch) {
    return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
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
  const original = rawUrl.trim();
  let url = original;

  // Step 1: Resolve short links
  const isShort =
    url.includes("goo.gl/maps/") ||
    url.includes("maps.app.goo.gl/") ||
    url.includes("maps.google.com/goo.gl");
  if (isShort) {
    url = await resolveUrl(url);
  }
  const resolvedUrl = url !== original ? url : undefined;

  // Step 2: Try to extract ChIJ Place ID (works with New API)
  const placeId = extractChIJPlaceId(url);
  if (placeId) {
    const coords = extractCoordinates(url);
    return {
      type: "place_id",
      placeId,
      lat: coords?.lat,
      lng: coords?.lng,
      resolvedUrl,
    };
  }

  // Step 3: If URL has FTid (0x...:0x...), the second hex is the Google CID —
  // an exact-match key DataForSEO accepts directly. Prefer this over text search.
  const ftid = extractFtid(url);
  if (ftid) {
    const cid = cidFromFtid(ftid);
    const s2Coords = ftidToCoordinates(ftid);
    const urlCoords = extractCoordinates(url);
    const bestCoords = urlCoords || s2Coords;

    if (cid) {
      return {
        type: "cid",
        cid,
        lat: bestCoords?.lat,
        lng: bestCoords?.lng,
        resolvedUrl,
      };
    }

    // No CID extractable — fall back to query + coords search.
    const query = extractSearchQuery(url);
    if (query && bestCoords) {
      return {
        type: "search",
        query,
        lat: bestCoords.lat,
        lng: bestCoords.lng,
        resolvedUrl,
      };
    }
    if (bestCoords) {
      return {
        type: "coordinates",
        lat: bestCoords.lat,
        lng: bestCoords.lng,
        resolvedUrl,
      };
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
      resolvedUrl,
    };
  }

  // Step 5: Search URL with coordinates
  const query = extractSearchQuery(url);
  const coords = extractCoordinates(url);

  if (query) {
    return {
      type: "search",
      query,
      lat: coords?.lat,
      lng: coords?.lng,
      resolvedUrl,
    };
  }

  // Step 6: Just coordinates
  if (coords) {
    return {
      type: "coordinates",
      lat: coords.lat,
      lng: coords.lng,
      resolvedUrl,
    };
  }

  return { type: "unknown", resolvedUrl };
}
