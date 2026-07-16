import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeUserStats } from "@/lib/places/user-stats";

// GET /api/stats — aggregate statistics for current user
//
// v1.21.0 (S3 AI-02): aggregation moved verbatim to
// src/lib/places/user-stats.ts so the assistant's get_stats tool shares it.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stats = await computeUserStats(supabase, user.id);
  return NextResponse.json(stats);
}
