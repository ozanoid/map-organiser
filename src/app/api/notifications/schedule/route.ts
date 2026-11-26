import { NextResponse } from "next/server";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { saveSchedule, scheduleInput } from "@/lib/notify/schedule-store";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PUT /api/notifications/schedule — the reminders and the weekly summary
 * (Phase 3, slice 2): every setting as the screen holds it. Returns the
 * settings as saved. Owners only, like every notification route.
 */
export async function PUT(req: Request) {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  const parsed = scheduleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  }
  try {
    return NextResponse.json({ schedule: await saveSchedule(createServiceClient(), ctx.userId, parsed.data) });
  } catch (e) {
    return errorResponse(e, "notifications.schedule.save");
  }
}
