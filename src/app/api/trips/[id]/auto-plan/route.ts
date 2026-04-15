import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autoPlanTrip } from "@/lib/trip/auto-plan";
import { parsePostgisPoint } from "@/lib/geo";

// POST /api/trips/[id]/auto-plan — auto-distribute places across days
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify trip ownership
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Get trip days
  const { data: days } = await supabase
    .from("trip_days")
    .select("id, day_number")
    .eq("trip_id", id)
    .order("day_number", { ascending: true });

  if (!days || days.length === 0) {
    return NextResponse.json({ error: "No days in trip" }, { status: 400 });
  }

  // Get ALL places currently in any day of this trip
  const dayIds = days.map((d) => d.id);
  const { data: existingPlacements } = await supabase
    .from("trip_day_places")
    .select("place_id, place:places(*, category:categories(*))")
    .in("trip_day_id", dayIds);

  if (!existingPlacements || existingPlacements.length === 0) {
    return NextResponse.json({ error: "No places to plan" }, { status: 400 });
  }

  // Parse PostGIS and deduplicate
  const placeMap = new Map<string, any>();
  for (const ep of existingPlacements) {
    const p = ep.place as any;
    if (!p || placeMap.has(p.id)) continue;
    placeMap.set(p.id, {
      ...p,
      location: parsePostgisPoint(p.location),
    });
  }
  const places = Array.from(placeMap.values());

  // Run auto-plan algorithm
  const planned = autoPlanTrip(places, days.length);

  // Clear existing placements
  await supabase.from("trip_day_places").delete().in("trip_day_id", dayIds);

  // Insert new placements
  for (const plan of planned) {
    const day = days.find((d) => d.day_number === plan.dayNumber);
    if (!day || plan.places.length === 0) continue;

    await supabase.from("trip_day_places").insert(
      plan.places.map((place, i) => ({
        trip_day_id: day.id,
        place_id: place.id,
        sort_order: i,
      }))
    );
  }

  return NextResponse.json({ success: true, planned: planned.map((p) => ({ dayNumber: p.dayNumber, placeCount: p.places.length })) });
}
