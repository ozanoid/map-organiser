import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";
import { getPlaceDetails, searchPlace } from "@/lib/google/places-api";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import type { BusinessInfoRequest } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";

/**
 * Extract CID from a resolved Google Maps URL's FTid.
 * Used only for DataForSEO path.
 */
function extractCidFromUrl(url: string): string | null {
  const cidParam = url.match(/[?&]cid=(\d+)/);
  if (cidParam) return cidParam[1];

  const ftidMatch = url.match(/!1s0x[a-f0-9]+:(0x[a-f0-9]+)/) ||
    url.match(/ftid=0x[a-f0-9]+:(0x[a-f0-9]+)/);
  if (ftidMatch) {
    try { return BigInt(ftidMatch[1]).toString(); } catch {}
  }
  return null;
}

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const startTime = Date.now();
    const parsed = await parseMapsUrl(url);
    const { googleApiKey } = await getUserApiKeys(user.id);

    console.log("[parse-link] Parsed URL:", JSON.stringify(parsed));

    // ─── Google key exists: use Google only (fast preview) ───
    // DataForSEO enrichment will run after save via enrichPlaceInBackground
    if (googleApiKey) {
      let placeData = null;

      switch (parsed.type) {
        case "place_id":
          if (parsed.placeId)
            placeData = await getPlaceDetails(parsed.placeId, googleApiKey, user.id);
          break;
        case "cid":
          if (parsed.lat && parsed.lng)
            placeData = await searchPlace(`${parsed.lat},${parsed.lng}`, googleApiKey, user.id, parsed.lat, parsed.lng);
          break;
        case "search":
          if (parsed.query)
            placeData = await searchPlace(parsed.query, googleApiKey, user.id, parsed.lat, parsed.lng);
          break;
        case "coordinates":
          if (parsed.lat && parsed.lng)
            placeData = await searchPlace(`${parsed.lat},${parsed.lng}`, googleApiKey, user.id, parsed.lat, parsed.lng);
          break;
      }

      if (placeData) {
        const fetchTimeMs = Date.now() - startTime;
        console.log(`[parse-link] Success: "${placeData.name}" in ${fetchTimeMs}ms via Google`);
        return NextResponse.json({
          ...placeData,
          photoRef: null, // DataForSEO handles photos in background enrichment
          _provider: "google",
          _fetchTimeMs: fetchTimeMs,
        });
      }

      // Google failed — fall through to DataForSEO
      console.log("[parse-link] Google returned no results, trying DataForSEO...");
    }

    // ─── No Google key (or Google failed): use DataForSEO ───
    const dfClient = getDataForSEOClient();
    if (!dfClient) {
      return NextResponse.json(
        { error: "No API credentials configured. Add a Google Places API key in Settings." },
        { status: 400 }
      );
    }

    const cidFromUrl = extractCidFromUrl(url);
    const locationCoord = parsed.lat && parsed.lng
      ? `${parsed.lat},${parsed.lng},1000` : undefined;

    let req: BusinessInfoRequest | null = null;
    if (cidFromUrl) {
      req = { keyword: `cid:${cidFromUrl}`, location_coordinate: locationCoord };
    } else if (parsed.type === "place_id" && parsed.placeId) {
      req = { keyword: `place_id:${parsed.placeId}`, location_coordinate: locationCoord };
    } else if (parsed.type === "search" && parsed.query) {
      req = { keyword: parsed.query, location_coordinate: locationCoord };
    } else if (parsed.lat && parsed.lng) {
      req = { keyword: `${parsed.lat},${parsed.lng}`, location_coordinate: `${parsed.lat},${parsed.lng},200` };
    }

    if (!req) {
      return NextResponse.json(
        { error: "Could not parse this URL. Please try a different Google Maps link." },
        { status: 400 }
      );
    }

    const raw = await fetchBusinessInfoLive(dfClient, req);
    if (!raw) {
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});

    const placeData = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);
    const fetchTimeMs = Date.now() - startTime;

    console.log(`[parse-link] Success: "${placeData.name}" in ${fetchTimeMs}ms via DataForSEO`);

    return NextResponse.json({
      ...placeData,
      _provider: "dataforseo",
      _fetchTimeMs: fetchTimeMs,
      _extended: extended,
    });
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
