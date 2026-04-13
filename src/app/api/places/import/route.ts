import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTakeoutGeoJson, parseTakeoutCsv } from "@/lib/google/takeout-parser";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { getPlaceDetails, searchPlace, downloadAndStorePhoto } from "@/lib/google/places-api";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";

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

    const { googleApiKey } = await getUserApiKeys(user.id);

    let imported = 0;
    let failed = 0;
    let enriched = 0;
    const skipped: { name: string; url: string | null; reason: string }[] = [];

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

        // Try to enrich from Google Maps URL (requires API key)
        if (p.googleMapsUrl && googleApiKey) {
          const parsed = await parseMapsUrl(p.googleMapsUrl);
          let details = null;

          if (parsed.type === "place_id" && parsed.placeId) {
            details = await getPlaceDetails(parsed.placeId, googleApiKey, user.id);
          } else if (parsed.type === "search" && parsed.query) {
            details = await searchPlace(parsed.query, googleApiKey, user.id, parsed.lat, parsed.lng);
          } else if ((parsed.lat && parsed.lng) || (lat && lng)) {
            details = await searchPlace(p.name, googleApiKey, user.id, parsed.lat || lat, parsed.lng || lng);
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
              rating: details.rating,
              opening_hours: details.openingHours,
              website: details.website,
              phone: details.phone,
              price_level: details.priceLevel,
              url: details.googleMapsUrl,
            };
            // Store photoRef for download after insert
            (googleData as Record<string, unknown>)._photoRef = details.photoRef;
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
          skipped.push({ name: p.name, url: p.googleMapsUrl, reason: "No coordinates" });
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
            failed++;
            skipped.push({ name: p.name, url: p.googleMapsUrl, reason: "Already exists" });
            continue;
          }
        }

        // Extract photoRef before insert (and remove from googleData)
        const photoRef = (googleData as Record<string, unknown>)?._photoRef as string | null;
        const cleanGoogleData = { ...googleData };
        delete (cleanGoogleData as Record<string, unknown>)._photoRef;

        const { data: insertedPlace, error } = await supabase.from("places").insert({
          user_id: user.id,
          name: p.name,
          address,
          country,
          city,
          location: `POINT(${lng} ${lat})`,
          notes: p.note,
          google_place_id: googlePlaceId,
          google_data: cleanGoogleData,
          category_id: categoryId,
          source: "import",
        }).select("id").single();

        if (error || !insertedPlace) {
          failed++;
          skipped.push({ name: p.name, url: p.googleMapsUrl, reason: error?.message || "Insert failed" });
          console.error("Import place error:", error?.message);
        } else {
          // Download 1 photo to Supabase Storage
          if (photoRef) {
            const storageUrl = await downloadAndStorePhoto(photoRef, insertedPlace.id, user.id, googleApiKey);
            if (storageUrl) {
              await supabase
                .from("places")
                .update({ google_data: { ...cleanGoogleData, photo_storage_url: storageUrl } })
                .eq("id", insertedPlace.id);
            }
          }
          imported++;
        }

        // Rate limit: small delay between API calls
        if (p.googleMapsUrl) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch {
        failed++;
        skipped.push({ name: p.name, url: p.googleMapsUrl, reason: "Unknown error" });
      }
    }

    return NextResponse.json({
      imported,
      failed,
      enriched,
      total: places.length,
      skipped,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to parse file. Upload a GeoJSON or CSV from Google Takeout." },
      { status: 400 }
    );
  }
}
