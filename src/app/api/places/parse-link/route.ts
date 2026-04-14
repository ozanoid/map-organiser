import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getProvider } from "@/lib/data-provider";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";
import type { ProviderCredentials } from "@/lib/data-provider/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await getUserApiKeys(user.id);
  const provider = await getProvider();

  // Build provider-agnostic credentials
  const credentials: ProviderCredentials = {
    googleApiKey: keys.googleApiKey,
    dataforseoLogin: keys.dataforseoLogin,
    dataforseoPassword: keys.dataforseoPassword,
  };

  // Validate credentials for the active provider
  if (provider.name === "google" && !keys.googleApiKey) {
    return NextResponse.json(
      { error: "Please add your Google Places API key in Settings" },
      { status: 400 }
    );
  }
  if (provider.name === "dataforseo" && (!keys.dataforseoLogin || !keys.dataforseoPassword)) {
    return NextResponse.json(
      { error: "Please configure DataForSEO credentials in Settings or .env" },
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
    let result = null;

    switch (parsed.type) {
      case "place_id":
        if (parsed.placeId) {
          result = await provider.getPlaceDetails(parsed.placeId, credentials, user.id);
        }
        break;

      case "cid":
        // DataForSEO handles CID natively (much better than Google's coord-based workaround)
        if (provider.name === "dataforseo" && parsed.cid) {
          result = await provider.getPlaceDetails(parsed.cid, credentials, user.id);
        } else if (parsed.lat && parsed.lng) {
          result = await provider.searchPlace(
            `${parsed.lat},${parsed.lng}`,
            credentials,
            user.id,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "search":
        if (parsed.query) {
          result = await provider.searchPlace(
            parsed.query,
            credentials,
            user.id,
            parsed.lat,
            parsed.lng
          );
        }
        break;

      case "coordinates":
        if (parsed.lat && parsed.lng) {
          result = await provider.searchPlace(
            `${parsed.lat},${parsed.lng}`,
            credentials,
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

    if (!result?.data) {
      return NextResponse.json(
        { error: "Could not find place details for this link." },
        { status: 404 }
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("Parse link error:", error);
    return NextResponse.json(
      { error: "Failed to parse link. Please try again." },
      { status: 500 }
    );
  }
}
