import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import { fetchReviews } from "@/lib/dataforseo/reviews";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import {
  transformBusinessInfoToPlaceData,
  transformReviews,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";

function getDataForSEOClient(): DataForSEOClient {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars required");
  }
  return new DataForSEOClient({ login, password });
}

export async function POST(
  _request: NextRequest,
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

  const { data: place, error: fetchError } = await supabase
    .from("places")
    .select("google_place_id, google_data, country")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  if (!place.google_place_id) {
    return NextResponse.json(
      { error: "No Google Place ID associated with this place" },
      { status: 400 }
    );
  }

  const client = getDataForSEOClient();
  const existingData = (place.google_data as Record<string, unknown>) || {};

  // 1. Fetch fresh business info via DataForSEO Live
  const placeId = place.google_place_id;
  const keyword = placeId.startsWith("ChIJ")
    ? `place_id:${placeId}`
    : `cid:${placeId}`;

  const raw = await fetchBusinessInfoLive(client, { keyword });
  trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});

  const details = raw ? transformBusinessInfoToPlaceData(raw) : null;
  const extended = raw ? extractExtendedData(raw) : {};

  // 2. Fetch reviews — need CID + location for the reviews endpoint
  const cid = raw?.cid || (existingData.cid as string) || null;
  let reviews: ReturnType<typeof transformReviews> = [];
  if (cid) {
    const rawReviews = await fetchReviews(client, {
      cid,
      depth: 50,
      location_name: place.country || "United States",
    });
    reviews = transformReviews(rawReviews);
    trackUsage(user.id, "dataforseo_reviews").catch(() => {});
  }

  // 3. Re-download photo if available
  let photoStorageUrl = existingData.photo_storage_url as string | undefined;
  if (details?.photoRef) {
    const newUrl = await downloadAndStorePhotoFromUrl(details.photoRef, id, user.id);
    if (newUrl) photoStorageUrl = newUrl;
  }

  // Calculate total ratings from distribution
  const dist = extended.rating_distribution as Record<string, number> | undefined;
  const userRatingsTotal = dist
    ? Object.values(dist).reduce((a: number, b: number) => a + b, 0)
    : existingData.user_ratings_total;

  const updatedGoogleData: Record<string, unknown> = {
    ...existingData,
    types: details?.types || existingData.types,
    rating: details?.rating ?? existingData.rating,
    user_ratings_total: userRatingsTotal,
    opening_hours: details?.openingHours || existingData.opening_hours,
    website: details?.website || existingData.website,
    phone: details?.phone || existingData.phone,
    price_level: details?.priceLevel ?? existingData.price_level,
    url: details?.googleMapsUrl || existingData.url,
    photo_storage_url: photoStorageUrl,
    reviews: reviews.length > 0 ? reviews : existingData.reviews,
    // DataForSEO extended fields
    ...extended,
  };

  // Clean legacy fields
  delete updatedGoogleData.photos;
  delete updatedGoogleData.editorial_summary;
  delete updatedGoogleData.editorialSummary;

  const { data: updated, error: updateError } = await supabase
    .from("places")
    .update({
      google_data: updatedGoogleData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, category:categories(*)")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
