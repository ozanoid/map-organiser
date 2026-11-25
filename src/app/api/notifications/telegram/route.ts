import { NextResponse } from "next/server";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { telegramStartLink, unlinkTelegram } from "@/lib/notify/channels";
import { telegramConfigured } from "@/lib/notify/config";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/notifications/telegram — the bot's start link with a one-time
 * token (15 minutes): opened in Telegram, Start links that chat to this
 * account (the webhook, /api/telegram/webhook).
 */
export async function POST() {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram isn't set up on this server." }, { status: 503 });
  }
  try {
    return NextResponse.json({ url: await telegramStartLink(createServiceClient(), ctx.userId) });
  } catch (e) {
    return errorResponse(e, "notifications.telegram.link");
  }
}

/** DELETE /api/notifications/telegram — unlinks the chat. */
export async function DELETE() {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  try {
    await unlinkTelegram(createServiceClient(), ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, "notifications.telegram.unlink");
  }
}
