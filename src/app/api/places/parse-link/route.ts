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
import type { ParsedPlaceData } from "@/lib/types";

/**
 * Extract CID from a resolved Google Maps URL's FTid.
 * Used only for DataForSEO (accepts cid: natively).
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

/**
 * Build a DataForSEO request from URL and parsed data.
 */
function buildDataForSEORequest(
  url: string,
  parsed: { type: string; placeId?: string; query?: string; lat?: number; lng?: number }
): BusinessInfoRequest | null {
  const cidFromUrl = extractCidFromUrl(url);
  const locationCoord = parsed.lat && parsed.lng
    ? `${parsed.lat},${parsed.lng},1000`
    : undefined;

  if (cidFromUrl) {
    return { keyword: `cid:${cidFromUrl}`, location_coordinate: locationCoord };
  }
  if (parsed.type === "place_id" && parsed.placeId) {
    return { keyword: `place_id:${parsed.placeId}`, location_coordinate: locationCoord };
  }
  if (parsed.type === "search" && parsed.query) {
    return { keyword: parsed.query, location_coordinate: locationCoord };
  }
  if (parsed.lat && parsed.lng) {
    return { keyword: `${parsed.lat},${parsed.lng}`, location_coordinate: `${parsed.lat},${parsed.lng},200` };
  }
  return null;
}

/**
 * Run Google Places API parse (same logic as main branch).
 */
async function parseViaGoogle(
  parsed: { type: string; placeId?: string; cid?: string; query?: string; lat?: number; lng?: number },
  googleApiKey: string,
  userId: string
): Promise<ParsedPlaceData | null> {
  switch (parsed.type) {
    case "place_id":
      if (parsed.placeId) return getPlaceDetails(parsed.placeId, googleApiKey, userId);
      break;
    case "cid":
      if (parsed.lat && parsed.lng)
        return searchPlace(`${parsed.lat},${parsed.lng}`, googleApiKey, userId, parsed.lat, parsed.lng);
      break;
    case "search":
      if (parsed.query)
        return searchPlace(parsed.query, googleApiKey, userId, parsed.lat, parsed.lng);
      break;
    case "coordinates":
      if (parsed.lat && parsed.lng)
        return searchPlace(`${parsed.lat},${parsed.lng}`, googleApiKey, userId, parsed.lat, parsed.lng);
      break;
  }
  return null;
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
    const dfClient = getDataForSEOClient();
    const dfReq = dfClient ? buildDataForSEORequest(url, parsed) : null;

    console.log("[parse-link] Parsed URL:", JSON.stringify(parsed));
    console.log("[parse-link] Google key:", !!googleApiKey, "| DataForSEO:", !!dfReq);

    // ─── Google key exists: run both in parallel, return whichever is faster ───
    if (googleApiKey && dfClient && dfReq) {
      const googlePromise = parseViaGoogle(parsed, googleApiKey, user.id)
        .catch((err) => { console.error("[parse-link] Google error:", err); return null; });

      const dfPromise = fetchBusinessInfoLive(dfClient, dfReq)
        .then((raw) => {
          if (!raw) return null;
          trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});
          return { placeData: transformBusinessInfoToPlaceData(raw), extended: extractExtendedData(raw) };
        })
        .catch((err) => { console.error("[parse-link] DataForSEO error:", err); return null; });

      // Wait for Google first (fast), DataForSEO may or may not be done
      const [googleResult, dfResult] = await Promise.all([googlePromise, dfPromise]);

      // Google succeeded — use it as preview, attach DataForSEO extended if available
      if (googleResult) {
        const fetchTimeMs = Date.now() - startTime;
        console.log(`[parse-link] Success: "${googleResult.name}" in ${fetchTimeMs}ms via Google` +
          (dfResult ? " (DataForSEO also ready)" : " (DataForSEO pending)"));

        return NextResponse.json({
          ...googleResult,
          photoRef: null, // DataForSEO handles photos in background enrichment
          _provider: "google",
          _fetchTimeMs: fetchTimeMs,
          ...(dfResult ? { _extended: dfResult.extended } : {}),
        });
      }

      // Google failed but DataForSEO succeeded
      if (dfResult) {
        const fetchTimeMs = Date.now() - startTime;
        console.log(`[parse-link] Google failed, using DataForSEO: "${dfResult.placeData.name}" in ${fetchTimeMs}ms`);

        return NextResponse.json({
          ...dfResult.placeData,
          _provider: "dataforseo",
          _fetchTimeMs: fetchTimeMs,
          _extended: dfResult.extended,
        });
      }

      // Both failed
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    // ─── Google key only (no DataForSEO) ───
    if (googleApiKey) {
      const placeData = await parseViaGoogle(parsed, googleApiKey, user.id);
      if (placeData) {
        const fetchTimeMs = Date.now() - startTime;
        console.log(`[parse-link] Success: "${placeData.name}" in ${fetchTimeMs}ms via Google`);
        return NextResponse.json({
          ...placeData,
          photoRef: null,
          _provider: "google",
          _fetchTimeMs: fetchTimeMs,
        });
      }
    }

    // ─── DataForSEO only (no Google key) ───
    if (dfClient && dfReq) {
      const raw = await fetchBusinessInfoLive(dfClient, dfReq);
      if (raw) {
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
      }
    }

    return NextResponse.json(
      { error: "Could not find place details for this link. Check your API credentials in Settings." },
      { status: 404 }
    );
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
