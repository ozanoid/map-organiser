import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlaceDetails } from "@/lib/google/places-api";

// POST /api/places/[id]/refresh-google-data
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

  // Fetch the place to get google_place_id
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

  // Fetch fresh data from Google Places API
  const details = await getPlaceDetails(place.google_place_id);

  if (!details) {
    return NextResponse.json(
      { error: "Failed to fetch data from Google Places API" },
      { status: 502 }
    );
  }

  // Merge fresh Google data into existing google_data
  const existingData = (place.google_data as Record<string, unknown>) || {};
  const updatedGoogleData = {
    ...existingData,
    types: details.types,
    photos: details.photos,
    rating: details.rating,
    user_ratings_total: undefined, // will be set below if available
    opening_hours: details.openingHours,
    website: details.website,
    phone: details.phone,
    reviews: details.reviews,
    editorial_summary: details.editorialSummary,
    price_level: details.priceLevel,
  };

  // Update the place in the database
  const { data: updated, error: updateError } = await supabase
    .from("places")
    .update({
      google_data: updatedGoogleData,
      rating: details.rating || undefined,
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
