import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import type { BusinessInfoRequest } from "@/lib/dataforseo/business-info";
import { transformBusinessInfoToPlaceData } from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";

function getDataForSEOClient(): DataForSEOClient {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars required");
  }
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
    const client = getDataForSEOClient();
    const parsed = await parseMapsUrl(url);

    console.log("[parse-link] Parsed URL:", JSON.stringify(parsed));

    // Build DataForSEO request from parsed URL data
    let req: BusinessInfoRequest | null = null;

    // Build location_coordinate from parsed coords (DataForSEO requires location for ALL queries)
    const locationCoord = parsed.lat && parsed.lng
      ? `${parsed.lat},${parsed.lng},1000`
      : undefined;

    switch (parsed.type) {
      case "place_id":
        if (parsed.placeId) {
          req = { keyword: `place_id:${parsed.placeId}`, location_coordinate: locationCoord };
        }
        break;

      case "cid":
        if (parsed.cid) {
          req = { keyword: `cid:${parsed.cid}`, location_coordinate: locationCoord };
        }
        break;

      case "search":
        if (parsed.query) {
          req = { keyword: parsed.query, location_coordinate: locationCoord };
        }
        break;

      case "coordinates":
        if (parsed.lat && parsed.lng) {
          req = {
            keyword: `${parsed.lat},${parsed.lng}`,
            location_coordinate: `${parsed.lat},${parsed.lng},200`,
          };
        }
        break;

      default:
        return NextResponse.json(
          { error: "Could not parse this URL. Please try a different Google Maps link." },
          { status: 400 }
        );
    }

    if (!req) {
      return NextResponse.json(
        { error: "Could not extract search parameters from this URL." },
        { status: 400 }
      );
    }

    console.log("[parse-link] DataForSEO request:", JSON.stringify(req));

    const raw = await fetchBusinessInfoLive(client, req);
    if (!raw) {
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});

    const placeData = transformBusinessInfoToPlaceData(raw);
    const fetchTimeMs = Date.now() - startTime;

    console.log(`[parse-link] Success: "${placeData.name}" in ${fetchTimeMs}ms via DataForSEO`);

    return NextResponse.json({
      ...placeData,
      _provider: "dataforseo",
      _fetchTimeMs: fetchTimeMs,
    });
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
