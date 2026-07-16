import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { retrieve, type RetrievedPlace } from "@/lib/mapbox/search-box";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";
// Same shared builder the paste flow (parse-link) uses, so the Mapbox
// search preview shows the same subcategory + AI suggestion chips.
import { buildLiteProfileForResponse } from "@/lib/ai/extract/lite-profile";

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

/**
 * GET /api/search/retrieve/[id]?session_token=<uuidv4>
 *
 * Mapbox Search Box `/retrieve` + optional DataForSEO enrichment.
 *
 * 1. Resolve Mapbox feature → coords + name + address.
 * 2. Track the Mapbox session (one billable session per suggest+retrieve pair).
 * 3. Call DataForSEO `business_info` with name + coords to enrich:
 *      rating, photos, opening hours, reviews, google_place_id (for dedup), …
 *    If DataForSEO has no match, return minimal Mapbox-only data.
 *
 * Response shape mirrors `/api/places/parse-link` so the same Save flow works.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionToken = request.nextUrl.searchParams.get("session_token");
  if (!sessionToken) {
    return NextResponse.json({ error: "session_token is required" }, { status: 400 });
  }

  const startTime = Date.now();
  const retrieved = await retrieve({ mapboxId: id, sessionToken });
  if (!retrieved) {
    return NextResponse.json(
      { error: "Could not retrieve place details." },
      { status: 404 }
    );
  }

  // One billable Mapbox session = one suggest→retrieve chain.
  trackUsage(user.id, "mapbox_search_session").catch(() => {});

  // Optional DataForSEO enrichment by name + coords.
  const client = getDataForSEOClient();
  let enriched: Awaited<ReturnType<typeof enrichWithDataForSEO>> = null;
  if (client) {
    enriched = await enrichWithDataForSEO(client, user.id, retrieved);
  }

  const fetchTimeMs = Date.now() - startTime;

  if (enriched) {
    const lite_profile = await buildLiteProfileForResponse(
      supabase,
      user.id,
      enriched.placeData,
      enriched.extended ?? null
    );
    return NextResponse.json({
      ...enriched.placeData,
      _provider: "dataforseo",
      _mapbox_id: retrieved.mapbox_id,
      _fetchTimeMs: fetchTimeMs,
      _extended: enriched.extended,
      lite_profile,
    });
  }

  // No DataForSEO match — return minimal Mapbox-only data, same shape.
  const minimalPlaceData = {
    placeId: "",
    name: retrieved.name,
    address: retrieved.full_address || retrieved.address || "",
    country: retrieved.country || "",
    city: retrieved.city || "",
    lat: retrieved.lat,
    lng: retrieved.lng,
    types: retrieved.poi_category || [],
    photos: [],
    photoRef: null,
    rating: null,
    openingHours: null,
    website: typeof retrieved.metadata?.website === "string" ? retrieved.metadata.website : null,
    phone: typeof retrieved.metadata?.phone === "string" ? retrieved.metadata.phone : null,
    priceLevel: null,
    googleMapsUrl: null,
  };
  // Even with no DataForSEO row, name+city+poi types are enough for the
  // heuristic to suggest existing lists/tags.
  const lite_profile = await buildLiteProfileForResponse(
    supabase,
    user.id,
    minimalPlaceData,
    null
  );
  return NextResponse.json({
    ...minimalPlaceData,
    _provider: "mapbox",
    _mapbox_id: retrieved.mapbox_id,
    _fetchTimeMs: fetchTimeMs,
    lite_profile,
  });
}

async function enrichWithDataForSEO(
  client: DataForSEOClient,
  userId: string,
  retrieved: RetrievedPlace
) {
  // Pad the Google text search with the Mapbox address so name-only collisions
  // are disambiguated; widen the coord bias because Mapbox/Google point geometry
  // often disagrees by a few hundred meters for the same business.
  const keyword = retrieved.full_address
    ? `${retrieved.name}, ${retrieved.full_address}`
    : retrieved.name;
  const locationCoord = `${retrieved.lat},${retrieved.lng},1000`;

  const raw = await fetchBusinessInfoLive(client, {
    keyword,
    location_coordinate: locationCoord,
  });

  if (!raw) return null;

  trackUsage(userId, "dataforseo_business_info_live").catch(() => {});

  const placeData = transformBusinessInfoToPlaceData(raw);
  const extended = extractExtendedData(raw);

  return { placeData, extended };
}
