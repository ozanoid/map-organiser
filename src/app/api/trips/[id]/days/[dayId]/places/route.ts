import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string; dayId: string }> };

// POST — add a place to a trip day
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const { place_id } = await request.json();

  if (!place_id) return NextResponse.json({ error: "place_id required" }, { status: 400 });

  // Verify ownership
  const { data: trip } = await supabase.from("trips").select("id").eq("id", tripId).eq("user_id", user.id).single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Get max sort_order for this day
  const { data: existing } = await supabase
    .from("trip_day_places")
    .select("sort_order")
    .eq("trip_day_id", dayId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("trip_day_places").insert({
    trip_day_id: dayId,
    place_id,
    sort_order: nextOrder,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE — remove a place from a trip day
export async function DELETE(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const { place_id } = await request.json();

  if (!place_id) return NextResponse.json({ error: "place_id required" }, { status: 400 });

  // Verify ownership
  const { data: trip } = await supabase.from("trips").select("id").eq("id", tripId).eq("user_id", user.id).single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const { error } = await supabase
    .from("trip_day_places")
    .delete()
    .eq("trip_day_id", dayId)
    .eq("place_id", place_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH — move a place to a different day
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const { place_id, target_day_id } = await request.json();

  if (!place_id || !target_day_id) {
    return NextResponse.json({ error: "place_id and target_day_id required" }, { status: 400 });
  }

  // Verify ownership
  const { data: trip } = await supabase.from("trips").select("id").eq("id", tripId).eq("user_id", user.id).single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Remove from current day
  await supabase.from("trip_day_places").delete().eq("trip_day_id", dayId).eq("place_id", place_id);

  // Get max sort_order for target day
  const { data: existing } = await supabase
    .from("trip_day_places")
    .select("sort_order")
    .eq("trip_day_id", target_day_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  // Add to target day
  const { error } = await supabase.from("trip_day_places").insert({
    trip_day_id: target_day_id,
    place_id,
    sort_order: nextOrder,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
