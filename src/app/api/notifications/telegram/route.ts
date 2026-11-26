import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/api/origin";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { telegramStartLink, unlinkTelegram } from "@/lib/notify/channels";
import { telegramConfigured } from "@/lib/notify/config";
import { NotifyError } from "@/lib/notify/errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/notifications/telegram — the bot's start link with a one-time
 * token (15 minutes): opened in Telegram, Start links that chat to this
 * account (the webhook, /api/telegram/webhook). In production the bot is
 * pointed at this deployment's webhook first (registerWebhook).
 */
export async function POST(req: Request) {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram isn't set up on this server." }, { status: 503 });
  }
  try {
    return NextResponse.json({ url: await telegramStartLink(createServiceClient(), ctx.userId, appOrigin(req)) });
  } catch (e) {
    // Telegram refused or couldn't be reached while the bot was pointed at
    // this deployment: say why (Telegram's own words, never the token).
    if (e instanceof NotifyError) {
      return NextResponse.json({ error: `Telegram couldn't be set up: ${e.message}` }, { status: 502 });
    }
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
