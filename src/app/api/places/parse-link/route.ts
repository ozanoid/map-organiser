import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getPlaceDetails, searchPlace } from "@/lib/google/places-api";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { googleApiKey } = await getUserApiKeys(user.id);
  if (!googleApiKey) {
    return NextResponse.json(
      { error: "Please add your Google Places API key in Settings" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const parsed = await parseMapsUrl(url);
    let placeData = null;

    switch (parsed.type) {
      case "place_id":
        if (parsed.placeId) {
          placeData = await getPlaceDetails(parsed.placeId, googleApiKey, user.id);
        }
        break;

      case "cid":
        if (parsed.lat && parsed.lng) {
          placeData = await searchPlace(
            `${parsed.lat},${parsed.lng}`,
            googleApiKey,
            user.id,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "search":
        if (parsed.query) {
          placeData = await searchPlace(
            parsed.query,
            googleApiKey,
            user.id,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "coordinates":
        if (parsed.lat && parsed.lng) {
          placeData = await searchPlace(
            `${parsed.lat},${parsed.lng}`,
            googleApiKey,
            user.id,
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
