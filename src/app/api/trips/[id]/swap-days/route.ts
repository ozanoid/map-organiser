import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/trips/[id]/swap-days — swap two days' order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: tripId } = await params;
  const { dayId, direction } = await request.json();

  if (!dayId || !["up", "down"].includes(direction)) {
    return NextResponse.json({ error: "dayId and direction (up|down) required" }, { status: 400 });
  }

  // Verify ownership
  const { data: trip } = await supabase.from("trips").select("id").eq("id", tripId).eq("user_id", user.id).single();
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Get all days ordered
  const { data: days } = await supabase
    .from("trip_days")
    .select("id, day_number, date")
    .eq("trip_id", tripId)
    .order("day_number", { ascending: true });

  if (!days || days.length < 2) return NextResponse.json({ error: "Not enough days" }, { status: 400 });

  const idx = days.findIndex((d) => d.id === dayId);
  if (idx === -1) return NextResponse.json({ error: "Day not found" }, { status: 404 });

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= days.length) {
    return NextResponse.json({ error: "Cannot move further" }, { status: 400 });
  }

  const dayA = days[idx];
  const dayB = days[swapIdx];

  // Swap day_number and date
  await Promise.all([
    supabase.from("trip_days").update({ day_number: dayB.day_number, date: dayB.date }).eq("id", dayA.id),
    supabase.from("trip_days").update({ day_number: dayA.day_number, date: dayA.date }).eq("id", dayB.id),
  ]);

  return NextResponse.json({ success: true });
}
