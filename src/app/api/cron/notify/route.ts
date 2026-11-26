import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/api/bearer";
import { appOrigin } from "@/lib/api/origin";
import { deliver } from "@/lib/notify/outbox";
import { runScheduler } from "@/lib/notify/scheduler";
import { supabaseSchedulerStore } from "@/lib/notify/scheduler-store";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/telemetry/logger";

/**
 * GET /api/cron/notify — Phase 3, slice 2: every 15 minutes (vercel.json),
 * the plans' reminders and the weekly summaries that are due, sent to the
 * owners' channels (src/lib/notify/scheduler.ts). Auth: Vercel's
 * `Authorization: Bearer ${CRON_SECRET}`, compared in constant time.
 *
 * Links in the messages point at the production address
 * (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel), else at the address the
 * cron called.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (!bearerMatches(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const appUrl = production ? `https://${production}` : appOrigin(req);
  const admin = createServiceClient();
  try {
    const summary = await runScheduler(supabaseSchedulerStore(admin), (d) => deliver(admin, d), new Date(), appUrl);
    log.info("notify.run", { ...summary });
    return NextResponse.json(summary);
  } catch (e) {
    log.error("notify.run_failed", e);
    return NextResponse.json({ error: "The run failed — see the logs." }, { status: 500 });
  }
}
