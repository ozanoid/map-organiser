import { NextResponse } from "next/server";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext } from "@/lib/notify/access";
import { settingsView } from "@/lib/notify/channels";
import type { NotificationSettingsView } from "@/lib/notify/types";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications — Settings → Notifications: the user's e-mail
 * address (and whether it is confirmed), their Telegram link, and whether
 * this server can send through each. `{ open: false }` for an account that
 * isn't the owner's (NotificationSettingsView).
 */
export async function GET() {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return NextResponse.json({ open: false } satisfies NotificationSettingsView);
  try {
    return NextResponse.json(await settingsView(createServiceClient(), ctx.userId));
  } catch (e) {
    return errorResponse(e, "notifications.read");
  }
}
