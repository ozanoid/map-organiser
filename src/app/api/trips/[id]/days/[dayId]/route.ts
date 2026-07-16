import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/trips/[id]/days/[dayId] — update a single trip day
// (v1.22.0, NF-07: routing_profile switching; notes editing rides along
// since AI-09 writes day themes there).
const BodySchema = z
  .object({
    routing_profile: z.enum(["walking", "driving", "cycling"]).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Empty body" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId, dayId } = await params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Verify trip ownership (two-level walk: day → trip → user)
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // maybeSingle: a 0-row update (wrong dayId / other trip's day) must be
  // a clean 404, not a PGRST116 500.
  const { data: day, error } = await supabase
    .from("trip_days")
    .update(parsed.data)
    .eq("id", dayId)
    .eq("trip_id", tripId)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }
  return NextResponse.json(day);
}
