import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoute } from "@/lib/trip/directions";
import { parsePostgisPoint } from "@/lib/geo";

// GET /api/trips/[id] — trip detail with days, places, and route data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Fetch days
  const { data: days } = await supabase
    .from("trip_days")
    .select("*")
    .eq("trip_id", id)
    .order("day_number", { ascending: true });

  // Fetch places for each day
  const enrichedDays = await Promise.all(
    (days || []).map(async (day) => {
      const { data: dayPlaces } = await supabase
        .from("trip_day_places")
        .select("*, place:places(*, category:categories(*))")
        .eq("trip_day_id", day.id)
        .order("sort_order", { ascending: true });

      // Transform PostGIS locations
      const places = (dayPlaces || []).map((dp: any) => ({
        ...dp,
        place: dp.place
          ? { ...dp.place, location: dp.place.location ? parsePostgisPoint(dp.place.location) : { lat: 0, lng: 0 } }
          : null,
      }));

      // Get route for this day if 2+ places
      const placeCoords = places
        .filter((dp: any) => dp.place?.location)
        .map((dp: any) => [dp.place.location.lng, dp.place.location.lat] as [number, number]);

      let route = null;
      if (placeCoords.length >= 2) {
        route = await getRoute(placeCoords, "walking");
      }

      return { ...day, places, route };
    })
  );

  const placeCount = enrichedDays.reduce((sum, d) => sum + (d.places?.length || 0), 0);

  return NextResponse.json({
    ...trip,
    days: enrichedDays,
    day_count: enrichedDays.length,
    place_count: placeCount,
  });
}

// PATCH /api/trips/[id] — update trip
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const { data, error } = await supabase
    .from("trips")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/trips/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
