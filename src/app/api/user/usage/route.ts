import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/google/track-usage";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const usage = await getMonthlyUsage(user.id);
  const totalEstimatedCost = usage.reduce((sum, u) => sum + u.estimatedCost, 0);

  return NextResponse.json({
    month: new Date().toISOString().substring(0, 7), // "2026-04"
    usage,
    totalEstimatedCost,
  });
}
