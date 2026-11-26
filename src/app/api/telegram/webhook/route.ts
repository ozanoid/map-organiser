import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { linkTelegram, setTelegramBlocked } from "@/lib/notify/channels";
import { telegramConfigured, telegramWebhookSecret } from "@/lib/notify/config";
import { escapeHtml } from "@/lib/notify/render";
import { telegramCall } from "@/lib/notify/telegram";
import { handleUpdate } from "@/lib/notify/telegram-updates";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/telemetry/logger";

/**
 * POST /api/telegram/webhook — Telegram posts the bot's updates here
 * (setWebhook with secret_token, allowed_updates: message, my_chat_member).
 * No session: the X-Telegram-Bot-Api-Secret-Token header, compared in
 * constant time, is what proves the request is Telegram's. The bot only
 * links chats and answers (Phase 3, decision 2) — fast, so it runs inline;
 * a failure is logged and still answered 200, else Telegram would keep
 * posting the same update.
 */
export async function POST(req: Request) {
  // Trimmed, as registerWebhook gave it to Telegram.
  const secret = telegramWebhookSecret();
  if (!telegramConfigured() || !secret) return new NextResponse(null, { status: 404 });

  const given = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const wanted = Buffer.from(secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return new NextResponse(null, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const admin = createServiceClient();
  try {
    await handleUpdate(update, {
      link: (token, chat) => linkTelegram(admin, token, chat),
      setBlocked: (chatId, blocked) => setTelegramBlocked(admin, chatId, blocked),
      reply: async (chatId, text) => {
        await telegramCall("sendMessage", { chat_id: chatId, text: escapeHtml(text), parse_mode: "HTML" });
      },
    });
  } catch (e) {
    log.error("telegram.update_failed", e, {
      updateId: (update as { update_id?: number } | null)?.update_id ?? null,
    });
  }
  return NextResponse.json({ ok: true });
}
