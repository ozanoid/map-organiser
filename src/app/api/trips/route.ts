import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/trips — list user's trips
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: trips, error } = await supabase
    .from("trips")
    .select("*, trip_days(id, day_number)")
    .eq("user_id", user.id)
    .order("start_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count places per trip
  const enriched = await Promise.all(
    (trips || []).map(async (trip) => {
      const dayIds = (trip.trip_days || []).map((d: { id: string }) => d.id);
      let placeCount = 0;
      if (dayIds.length > 0) {
        const { count } = await supabase
          .from("trip_day_places")
          .select("id", { count: "exact", head: true })
          .in("trip_day_id", dayIds);
        placeCount = count || 0;
      }
      return {
        ...trip,
        day_count: trip.trip_days?.length || 0,
        place_count: placeCount,
        trip_days: undefined,
      };
    })
  );

  return NextResponse.json(enriched);
}

// POST /api/trips — create a new trip
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, start_date, end_date, list_id, place_ids } = body;

  if (!name || !start_date || !end_date) {
    return NextResponse.json({ error: "name, start_date, end_date required" }, { status: 400 });
  }

  // Create trip
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .insert({ user_id: user.id, name, start_date, end_date, list_id: list_id || null })
    .select()
    .single();

  if (tripError) return NextResponse.json({ error: tripError.message }, { status: 500 });

  // Calculate day count
  const start = new Date(start_date);
  const end = new Date(end_date);
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  // Create trip_days
  const days = Array.from({ length: dayCount }, (_, i) => ({
    trip_id: trip.id,
    day_number: i + 1,
    date: new Date(start.getTime() + i * 86400000).toISOString().split("T")[0],
  }));

  const { data: createdDays, error: daysError } = await supabase
    .from("trip_days")
    .insert(days)
    .select();

  if (daysError) return NextResponse.json({ error: daysError.message }, { status: 500 });

  // If list_id or place_ids provided, add places to first day (auto-plan will redistribute)
  let initialPlaceIds: string[] = [];

  if (list_id) {
    const { data: listPlaces } = await supabase
      .from("list_places")
      .select("place_id")
      .eq("list_id", list_id)
      .order("sort_order", { ascending: true });
    initialPlaceIds = (listPlaces || []).map((lp) => lp.place_id);
  } else if (place_ids?.length) {
    initialPlaceIds = place_ids;
  }

  if (initialPlaceIds.length > 0 && createdDays && createdDays.length > 0) {
    // Put all places in day 1 initially — auto-plan will redistribute
    const firstDayId = createdDays.find((d) => d.day_number === 1)?.id;
    if (firstDayId) {
      await supabase.from("trip_day_places").insert(
        initialPlaceIds.map((placeId, i) => ({
          trip_day_id: firstDayId,
          place_id: placeId,
          sort_order: i,
        }))
      );
    }
  }

  return NextResponse.json({ ...trip, day_count: dayCount, place_count: initialPlaceIds.length });
}
