import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/google/track-usage";
import { MONTHLY_CAP_USD, monthSpendByPurpose, SPEND_PURPOSES } from "@/lib/agent/spend";
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
  // Every Claude call this month, in dollars, against the platform-wide cap
  // (assistant_spend: the assistant, place profiles, Instagram reads, evals —
  // one ledger, one cap), and what each purpose took.
  let byPurpose = Object.fromEntries(SPEND_PURPOSES.map((p) => [p, 0])) as Awaited<
    ReturnType<typeof monthSpendByPurpose>
  >;
  try {
    byPurpose = await monthSpendByPurpose(createServiceClient());
  } catch (e) {
    log.warn("usage.assistant_spend_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  const claudeSpentUsd = Object.values(byPurpose).reduce((a, b) => a + b, 0);
  const totalEstimatedCost = usage.reduce((sum, u) => sum + u.estimatedCost, 0) + claudeSpentUsd;

  return NextResponse.json({
    month: new Date().toISOString().substring(0, 7), // "2026-04"
    usage,
    assistant: { spentUsd: claudeSpentUsd, capUsd: MONTHLY_CAP_USD, byPurpose },
    totalEstimatedCost,
  });
}
