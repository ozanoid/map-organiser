import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlaceReviews, getPlaceDetails, downloadAndStorePhoto } from "@/lib/google/places-api";

/**
 * POST /api/places/[id]/refresh-google-data
 *
 * Refreshes Google data for a place:
 * - PRO tier ($17/1K): basic info, hours, website, phone, price
 * - ENTERPRISE tier ($20/1K): reviews (separate call)
 * - PHOTOS ($7/1K): re-downloads 1 photo to Supabase Storage
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

  const existingData = (place.google_data as Record<string, unknown>) || {};

  // 1. Fetch fresh basic data (PRO tier - $17/1K)
  const details = await getPlaceDetails(place.google_place_id);

  // 2. Fetch reviews separately (ENTERPRISE tier - $20/1K)
  const reviews = await getPlaceReviews(place.google_place_id);

  // 3. Re-download photo if available (PHOTOS - $7/1K)
  let photoStorageUrl = existingData.photo_storage_url as string | undefined;
  if (details?.photoRef) {
    const newUrl = await downloadAndStorePhoto(details.photoRef, id, user.id);
    if (newUrl) photoStorageUrl = newUrl;
  }

  const updatedGoogleData = {
    ...existingData,
    types: details?.types || existingData.types,
    rating: details?.rating || existingData.rating,
    opening_hours: details?.openingHours || existingData.opening_hours,
    website: details?.website || existingData.website,
    phone: details?.phone || existingData.phone,
    price_level: details?.priceLevel ?? existingData.price_level,
    url: details?.googleMapsUrl || existingData.url,
    photo_storage_url: photoStorageUrl,
    reviews: reviews.length > 0 ? reviews : existingData.reviews,
  };

  // Remove legacy fields
  const cleanData = updatedGoogleData as Record<string, unknown>;
  delete cleanData.photos;
  delete cleanData.editorial_summary;
  delete cleanData.editorialSummary;

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
