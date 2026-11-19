import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { dataForSeoClientFromEnv } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive, LIVE_LOOKUP_TIMEOUT_MS } from "@/lib/dataforseo/business-info";
import type { BusinessInfoRequest } from "@/lib/dataforseo/business-info";
import type { RawBusinessInfo } from "@/lib/dataforseo/api-types";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { extractCidFromUrl } from "@/lib/import/process-place";
import { reverseGeocode } from "@/lib/mapbox/search-box";
import { trackUsage } from "@/lib/google/track-usage";
// buildLiteProfileForResponse is shared with /api/search/retrieve so the
// two preview flows can't drift out of feature parity again.
import { buildLiteProfileForResponse } from "@/lib/ai/extract/lite-profile";

/**
 * POST /api/places/parse-link { url } — a pasted Google Maps link → the
 * place's details for the Add Place preview, through DataForSEO's business
 * info (one lookup, $0.0054). Google's own Places API was a second path for
 * users with a key; it was removed with the move to DataForSEO (v1.42.0).
 *
 * 404 — DataForSEO looked and has no such place (billed, so counted);
 * 502 — the lookup itself failed: DataForSEO down or out of balance, or no
 * answer within LIVE_LOOKUP_TIMEOUT_MS (not billed, not counted). Both used
 * to answer 404 "not found".
 */

const Body = z.object({ url: z.string().trim().min(1) });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }
  const { url } = body.data;

  try {
    const startTime = Date.now();
    const parsed = await parseMapsUrl(url);
    console.log("[parse-link] Parsed URL:", JSON.stringify(parsed));

    const dfClient = dataForSeoClientFromEnv();
    if (!dfClient) {
      return NextResponse.json({ error: "Place lookup isn't set up on this server." }, { status: 503 });
    }

    const cidFromUrl = extractCidFromUrl(url);
    const locationCoord = parsed.lat && parsed.lng
      ? `${parsed.lat},${parsed.lng},1000` : undefined;

    let req: BusinessInfoRequest | null = null;
    if (cidFromUrl) {
      req = { keyword: `cid:${cidFromUrl}`, location_coordinate: locationCoord };
    } else if (parsed.type === "cid" && parsed.cid) {
      // Parser extracted CID from FTid (short links resolved server-side).
      // Exact-match Business Info lookup — preferred over text search.
      req = { keyword: `cid:${parsed.cid}`, location_coordinate: locationCoord };
    } else if (parsed.type === "place_id" && parsed.placeId) {
      req = { keyword: `place_id:${parsed.placeId}`, location_coordinate: locationCoord };
    } else if (parsed.type === "search" && parsed.query) {
      // Short queries like "Beam" lose against Google's text search even with
      // a tight coord bias. Reverse-geocode the URL's coords to pad the keyword
      // with neighborhood + city + country context — same trick used in the
      // /map search-box flow.
      let keyword = parsed.query;
      if (parsed.lat && parsed.lng) {
        const ctx = await reverseGeocode({ lng: parsed.lng, lat: parsed.lat });
        const suffix = ctx?.full_address
          || [ctx?.address, ctx?.city, ctx?.country].filter(Boolean).join(", ");
        if (suffix) keyword = `${parsed.query}, ${suffix}`;
      }
      req = {
        keyword,
        location_coordinate: parsed.lat && parsed.lng
          ? `${parsed.lat},${parsed.lng},2000`
          : locationCoord,
      };
    } else if (parsed.lat && parsed.lng) {
      req = { keyword: `${parsed.lat},${parsed.lng}`, location_coordinate: `${parsed.lat},${parsed.lng},200` };
    }

    if (!req) {
      return NextResponse.json(
        { error: "Could not parse this URL. Please try a different Google Maps link." },
        { status: 400 }
      );
    }

    let raw: RawBusinessInfo | null;
    try {
      raw = await fetchBusinessInfoLive(dfClient, req, {
        throwOnError: true,
        signal: AbortSignal.timeout(LIVE_LOOKUP_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("[parse-link] Lookup failed:", error);
      return NextResponse.json(
        { error: "Couldn't look this place up right now. Please try again." },
        { status: 502 }
      );
    }
    // DataForSEO bills a lookup it ran whether or not it found the place.
    await trackUsage(user.id, "dataforseo_business_info_live", supabase).catch(() => {});

    if (!raw) {
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    const placeData = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);
    const fetchTimeMs = Date.now() - startTime;

    console.log(`[parse-link] Success: "${placeData.name}" in ${fetchTimeMs}ms via DataForSEO`);

    const lite_profile = await buildLiteProfileForResponse(
      supabase,
      user.id,
      placeData,
      extended ?? null
    );

    return NextResponse.json({
      ...placeData,
      _provider: "dataforseo",
      _fetchTimeMs: fetchTimeMs,
      _extended: extended,
      lite_profile,
    });
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
