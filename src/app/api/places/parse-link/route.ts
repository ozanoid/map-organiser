import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getPlaceDetails, searchPlace } from "@/lib/google/places-api";

export async function POST(request: NextRequest) {
  // Auth check
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
    // Step 1: Parse the URL
    const parsed = await parseMapsUrl(url);

    // Step 2: Fetch place details based on parsed result
    let placeData = null;

    switch (parsed.type) {
      case "place_id":
        if (parsed.placeId) {
          placeData = await getPlaceDetails(parsed.placeId);
        }
        break;

      case "cid":
        // CID doesn't work directly with new API, use search with coordinates
        if (parsed.lat && parsed.lng) {
          placeData = await searchPlace(
            `${parsed.lat},${parsed.lng}`,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "search":
        if (parsed.query) {
          placeData = await searchPlace(
            parsed.query,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "coordinates":
        if (parsed.lat && parsed.lng) {
          // Reverse geocode via text search
          placeData = await searchPlace(
            `${parsed.lat},${parsed.lng}`,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      default:
        return NextResponse.json(
          { error: "Could not parse this URL. Please try a different Google Maps link." },
          { status: 400 }
        );
    }

    if (!placeData) {
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    return NextResponse.json(placeData);
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
