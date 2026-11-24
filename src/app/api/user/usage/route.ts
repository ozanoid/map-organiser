import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/google/track-usage";
import { MONTHLY_CAP_USD, supabaseSpendLedger } from "@/lib/agent/spend";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/telemetry/logger";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const usage = await getMonthlyUsage(user.id);
  // The Claude assistant's spend this month, in dollars, against the
  // platform-wide cap (assistant_spend — every Claude call, evals included).
  let assistantSpentUsd = 0;
  try {
    assistantSpentUsd = await supabaseSpendLedger(createServiceClient()).monthToDate();
  } catch (e) {
    log.warn("usage.assistant_spend_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  const totalEstimatedCost = usage.reduce((sum, u) => sum + u.estimatedCost, 0) + assistantSpentUsd;

  return NextResponse.json({
    month: new Date().toISOString().substring(0, 7), // "2026-04"
    usage,
    assistant: { spentUsd: assistantSpentUsd, capUsd: MONTHLY_CAP_USD },
    totalEstimatedCost,
  });
}
