import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/data-provider";
import type { ProviderCredentials } from "@/lib/data-provider/types";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";

/**
 * POST /api/places/[id]/refresh-google-data
 *
 * Refreshes place data via the active provider (Google or DataForSEO).
 * Fetches details, reviews, and re-downloads photo.
 */
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
    .select("google_place_id, google_data")
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

  const keys = await getUserApiKeys(user.id);
  const provider = await getProvider();
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
      { error: "Please configure DataForSEO credentials" },
      { status: 400 }
    );
  }

  const existingData = (place.google_data as Record<string, unknown>) || {};

  // 1. Fetch fresh details via provider
  const detailsResult = await provider.getPlaceDetails(
    place.google_place_id,
    credentials,
    user.id
  );
  const details = detailsResult?.data ?? null;
  const extended = detailsResult?.extended ?? {};

  // 2. Fetch reviews via provider
  const reviews = await provider.getPlaceReviews(
    place.google_place_id,
    credentials,
    user.id,
    provider.name === "dataforseo" ? 50 : undefined // DataForSEO: fetch more reviews
  );

  // 3. Re-download photo if available
  let photoStorageUrl = existingData.photo_storage_url as string | undefined;
  if (details?.photoRef) {
    const newUrl = await provider.downloadAndStorePhoto(
      details.photoRef,
      id,
      user.id,
      credentials
    );
    if (newUrl) photoStorageUrl = newUrl;
  }

  const updatedGoogleData: Record<string, unknown> = {
    ...existingData,
    types: details?.types || existingData.types,
    rating: details?.rating ?? existingData.rating,
    user_ratings_total: extended.rating_distribution
      ? Object.values(extended.rating_distribution).reduce((a, b) => a + b, 0)
      : existingData.user_ratings_total,
    opening_hours: details?.openingHours || existingData.opening_hours,
    website: details?.website || existingData.website,
    phone: details?.phone || existingData.phone,
    price_level: details?.priceLevel ?? existingData.price_level,
    url: details?.googleMapsUrl || existingData.url,
    photo_storage_url: photoStorageUrl,
    reviews: reviews.length > 0 ? reviews : existingData.reviews,
    // DataForSEO extended fields (only populated when provider is dataforseo)
    ...extended,
  };

  // Remove legacy fields
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
