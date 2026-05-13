import "server-only";

/**
 * Mapbox Search Box API thin wrapper.
 *
 * Two endpoints:
 *   - suggest(q, sessionToken, opts?)   → autocomplete list
 *   - retrieve(mapboxId, sessionToken) → full feature with coords + address
 *
 * Both share a session_token (UUIDv4) — Mapbox bills one billable session
 * for the suggest→retrieve pair. After 180s inactivity, 50 suggest calls,
 * or a successful retrieve, the session ends — caller mints a new UUID.
 *
 * Docs: https://docs.mapbox.com/api/search/search-box/
 */

export interface SuggestRequest {
  q: string;
  sessionToken: string;
  proximity?: { lng: number; lat: number };
  limit?: number;
  language?: string;
}

export interface RetrieveRequest {
  mapboxId: string;
  sessionToken: string;
  language?: string;
}

export interface SearchSuggestion {
  mapbox_id: string;
  name: string;
  name_preferred?: string;
  feature_type: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  context?: {
    country?: { name?: string; country_code?: string };
    region?: { name?: string };
    place?: { name?: string };
    locality?: { name?: string };
    neighborhood?: { name?: string };
  };
  language?: string;
  maki?: string;
  poi_category?: string[];
  poi_category_ids?: string[];
  brand?: string[];
  external_ids?: Record<string, string>;
  metadata?: Record<string, unknown>;
  distance?: number;
}

export interface RetrievedPlace {
  mapbox_id: string;
  name: string;
  feature_type: string;
  lng: number;
  lat: number;
  full_address?: string;
  address?: string;
  country?: string;
  city?: string;
  poi_category?: string[];
  brand?: string[];
  external_ids?: Record<string, string>;
  metadata?: {
    phone?: string;
    website?: string;
    open_hours?: unknown;
    [k: string]: unknown;
  };
  maki?: string;
}

const SEARCH_BASE = "https://api.mapbox.com/search/searchbox/v1";

function getToken(): string {
  // Server-only token preferred; fall back to public token if it's all we have.
  const t = process.env.MAPBOX_SERVER_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  return t;
}

/**
 * GET /search/searchbox/v1/suggest
 * Hard-codes types=poi (we only add places, not cities or postcodes).
 */
export async function suggest(req: SuggestRequest): Promise<SearchSuggestion[]> {
  const token = getToken();
  if (!token) return [];

  const params = new URLSearchParams({
    q: req.q,
    access_token: token,
    session_token: req.sessionToken,
    language: req.language || "en",
    types: "poi",
    limit: String(req.limit ?? 8),
  });
  if (req.proximity) {
    params.set("proximity", `${req.proximity.lng},${req.proximity.lat}`);
  }

  try {
    const res = await fetch(`${SEARCH_BASE}/suggest?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[mapbox/search-box] suggest ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data.suggestions || []) as SearchSuggestion[];
  } catch (e) {
    console.error("[mapbox/search-box] suggest error:", e);
    return [];
  }
}

/**
 * GET /search/searchbox/v1/retrieve/{id}
 * Closes the session token on success.
 */
export async function retrieve(req: RetrieveRequest): Promise<RetrievedPlace | null> {
  const token = getToken();
  if (!token) return null;

  const params = new URLSearchParams({
    access_token: token,
    session_token: req.sessionToken,
    language: req.language || "en",
  });

  try {
    const res = await fetch(
      `${SEARCH_BASE}/retrieve/${encodeURIComponent(req.mapboxId)}?${params.toString()}`
    );
    if (!res.ok) {
      console.warn(`[mapbox/search-box] retrieve ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    const props = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates || [0, 0];

    return {
      mapbox_id: props.mapbox_id || req.mapboxId,
      name: props.name || "",
      feature_type: props.feature_type || "poi",
      lng,
      lat,
      full_address: props.full_address,
      address: props.address,
      country: props.context?.country?.name,
      city: props.context?.place?.name || props.context?.locality?.name,
      poi_category: props.poi_category,
      brand: props.brand,
      external_ids: props.external_ids,
      metadata: props.metadata,
      maki: props.maki,
    };
  } catch (e) {
    console.error("[mapbox/search-box] retrieve error:", e);
    return null;
  }
}
