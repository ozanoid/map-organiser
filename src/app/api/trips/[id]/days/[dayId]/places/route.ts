import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { defaultCostEstimate } from "@/lib/trip/cost-defaults";

type Params = { params: Promise<{ id: string; dayId: string }> };

// Ownership walk: trip belongs to user AND day belongs to trip. Keying
// writes on dayId alone would let a caller aim at another of their own
// trips' days through a mismatched URL.
async function verifyDay(
  supabase: any,
  tripId: string,
  dayId: string,
  userId: string
) {
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", userId)
    .single();
  if (!trip) return false;
  const { data: day } = await supabase
    .from("trip_days")
    .select("id")
    .eq("id", dayId)
    .eq("trip_id", tripId)
    .single();
  return !!day;
}

// POST — add a place to a trip day
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const { place_id } = await request.json();

  if (!place_id) return NextResponse.json({ error: "place_id required" }, { status: 400 });

  if (!(await verifyDay(supabase, tripId, dayId, user.id)))
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Ownership gate on the PLACE, not just the trip: trip_day_places RLS
  // only walks trip_day_id, so a foreign place UUID (learned from any
  // public share) would otherwise attach — and the public trip share
  // would then leak the victim's full row through the service client.
  const { data: place } = await supabase
    .from("places")
    .select("google_data")
    .eq("id", place_id)
    .eq("user_id", user.id)
    .single();
  if (!place) return NextResponse.json({ error: "Place not found" }, { status: 404 });

  // Get max sort_order for this day
  const { data: existing } = await supabase
    .from("trip_day_places")
    .select("sort_order")
    .eq("trip_day_id", dayId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  // NF-08 (v1.22.0): seed the per-person cost estimate from price_level.
  const { error } = await supabase.from("trip_day_places").insert({
    trip_day_id: dayId,
    place_id,
    sort_order: nextOrder,
    cost_estimate: defaultCostEstimate(place.google_data),
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

  if (!(await verifyDay(supabase, tripId, dayId, user.id)))
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const { error } = await supabase
    .from("trip_day_places")
    .delete()
    .eq("trip_day_id", dayId)
    .eq("place_id", place_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH — move a place to a different day, OR update its row fields.
//
// Two shapes (v1.22.0 widened for NF-08):
//   { place_id, target_day_id }              → move
//   { place_id, cost_estimate | time_slot | notes } → in-place update
const MoveSchema = z.object({
  place_id: z.string().uuid(),
  target_day_id: z.string().uuid(),
});
const UpdateSchema = z
  .object({
    place_id: z.string().uuid(),
    cost_estimate: z.number().min(0).max(100000).nullable().optional(),
    time_slot: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 1, { message: "No fields to update" });

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;
  const body = await request.json().catch(() => ({}));

  if (!(await verifyDay(supabase, tripId, dayId, user.id)))
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const move = MoveSchema.safeParse(body);
  if (move.success) {
    const { place_id, target_day_id } = move.data;

    // Target day must belong to the SAME trip.
    const { data: targetDay } = await supabase
      .from("trip_days")
      .select("id")
      .eq("id", target_day_id)
      .eq("trip_id", tripId)
      .single();
    if (!targetDay)
      return NextResponse.json({ error: "Target day not found" }, { status: 404 });

    const { data: existing } = await supabase
      .from("trip_day_places")
      .select("sort_order")
      .eq("trip_day_id", target_day_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    // Single atomic UPDATE (pre-v1.22.0 this was delete+insert, which
    // could lose the row on a mid-move failure and dropped
    // cost/time_slot/notes; an UPDATE moves the row fields and all).
    // 0 rows updated = the place wasn't in the source day → 404.
    const { data: moved, error } = await supabase
      .from("trip_day_places")
      .update({ trip_day_id: target_day_id, sort_order: nextOrder })
      .eq("trip_day_id", dayId)
      .eq("place_id", place_id)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!moved || moved.length === 0)
      return NextResponse.json({ error: "Place not in this day" }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const update = UpdateSchema.safeParse(body);
  if (update.success) {
    const { place_id, ...fields } = update.data;
    const { error } = await supabase
      .from("trip_day_places")
      .update(fields)
      .eq("trip_day_id", dayId)
      .eq("place_id", place_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "place_id and target_day_id (move) or update fields required" },
    { status: 400 }
  );
}
