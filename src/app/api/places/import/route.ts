import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTakeoutGeoJson, parseTakeoutCsv } from "@/lib/google/takeout-parser";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getPlaceDetails, searchPlace } from "@/lib/google/places-api";
import { resolveCategoryId } from "@/lib/google/category-mapping";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const fileName = file.name.toLowerCase();
    const isCsv = fileName.endsWith(".csv");

    let places;
    if (isCsv) {
      places = parseTakeoutCsv(text);
    } else {
      const json = JSON.parse(text);
      places = parseTakeoutGeoJson(json);
    }

    if (places.length === 0) {
      return NextResponse.json({ error: "No valid places found in file" }, { status: 400 });
    }

    // Fetch user categories for auto-categorization
    const { data: userCategories } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id);

    let imported = 0;
    let failed = 0;
    let enriched = 0;

    // For CSV imports, try to enrich each place via Google Places API
    // Process one by one to respect rate limits
    for (const p of places) {
      try {
        let googleData: Record<string, unknown> = {};
        let googlePlaceId: string | null = null;
        let address = p.address;
        let country: string | null = null;
        let city: string | null = null;
        let lat = p.lat;
        let lng = p.lng;
        let categoryId: string | null = null;

        // Try to enrich from Google Maps URL
        if (p.googleMapsUrl) {
          const parsed = await parseMapsUrl(p.googleMapsUrl);
          let details = null;

          if (parsed.type === "place_id" && parsed.placeId) {
            details = await getPlaceDetails(parsed.placeId);
          } else if (parsed.type === "search" && parsed.query) {
            details = await searchPlace(parsed.query, parsed.lat, parsed.lng);
          } else if ((parsed.lat && parsed.lng) || (lat && lng)) {
            details = await searchPlace(p.name, parsed.lat || lat, parsed.lng || lng);
          }

          if (details) {
            googlePlaceId = details.placeId;
            address = details.address || address;
            country = details.country;
            city = details.city;
            lat = details.lat || lat;
            lng = details.lng || lng;
            googleData = {
              types: details.types,
              photos: details.photos,
              rating: details.rating,
              opening_hours: details.openingHours,
              website: details.website,
              phone: details.phone,
              reviews: details.reviews,
              editorial_summary: details.editorialSummary,
              price_level: details.priceLevel,
              url: details.googleMapsUrl,
            };
            enriched++;

            // Auto-categorize
            if (details.types?.length && userCategories?.length) {
              categoryId = resolveCategoryId(details.types, userCategories, p.name);
            }
          }
        }

        // Skip if no valid coordinates
        if (!lat || !lng) {
          failed++;
          continue;
        }

        // Check duplicate by google_place_id
        if (googlePlaceId) {
          const { data: existing } = await supabase
            .from("places")
            .select("id")
            .eq("user_id", user.id)
            .eq("google_place_id", googlePlaceId)
            .maybeSingle();

          if (existing) {
            failed++; // Skip duplicate
            continue;
          }
        }

        const { error } = await supabase.from("places").insert({
          user_id: user.id,
          name: p.name,
          address,
          country,
          city,
          location: `POINT(${lng} ${lat})`,
          notes: p.note,
          google_place_id: googlePlaceId,
          google_data: googleData,
          category_id: categoryId,
          source: "import",
        });

        if (error) {
          failed++;
          console.error("Import place error:", error.message);
        } else {
          imported++;
        }

        // Rate limit: small delay between API calls
        if (p.googleMapsUrl) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch {
        failed++;
      }
    }

    return NextResponse.json({
      imported,
      failed,
      enriched,
      total: places.length,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to parse file. Upload a GeoJSON or CSV from Google Takeout." },
      { status: 400 }
    );
  }
}
