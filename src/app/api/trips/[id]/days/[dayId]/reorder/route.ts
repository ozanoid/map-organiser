import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/trips/[id]/days/[dayId]/reorder — reorder places within a day
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const { placeIds } = await request.json();

  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return NextResponse.json({ error: "placeIds array required" }, { status: 400 });
  }

  // Verify trip ownership
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Update sort_order for each place in this day
  const updates = placeIds.map((placeId: string, index: number) =>
    supabase
      .from("trip_day_places")
      .update({ sort_order: index })
      .eq("trip_day_id", dayId)
      .eq("place_id", placeId)
  );

  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
