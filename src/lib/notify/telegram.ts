import "server-only";
import { telegramBotUsername } from "@/lib/notify/config";
import { NotifyError, TelegramChatGone } from "@/lib/notify/errors";
import { log } from "@/lib/telemetry/logger";

export { TELEGRAM_MAX_CHARS } from "@/lib/notify/telegram-limits";

/**
 * The Telegram Bot API (docs/04-integrations/telegram.md). Messages use the
 * HTML parse mode: only <, > and & need escaping, unlike MarkdownV2's
 * eighteen characters. The token sits in the URL Telegram requires, so a
 * failure reports the API's description, never the request.
 */
const API = "https://api.telegram.org";

interface ApiAnswer<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export async function telegramCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new NotifyError("Telegram isn't set up on this server (TELEGRAM_BOT_TOKEN).", false);
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new NotifyError(`Telegram ${method}: the request failed.`, true);
  }
  const answer = (await res.json().catch(() => null)) as ApiAnswer<T> | null;
  if (answer?.ok) return answer.result as T;
  const code = answer?.error_code ?? res.status;
  const description = answer?.description ?? `HTTP ${res.status}`;
  if (code === 403) throw new TelegramChatGone(`Telegram: ${description}`);
  throw new NotifyError(`Telegram: ${description}`, code === 429 || code >= 500, answer?.parameters?.retry_after);
}

/** Sends one message; returns its message id. Links show no preview: a
 *  plan's message carries several. */
export async function sendTelegram(chatId: number, html: string): Promise<string> {
  const result = await telegramCall<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  return String(result.message_id);
}

/** The updates the bot needs: messages (/start) and its own membership in a
 *  chat (blocked / unblocked). */
export const TELEGRAM_UPDATES = ["message", "my_chat_member"] as const;

/**
 * Points the bot at this deployment's webhook — run on every "Connect
 * Telegram" (Ozan's choice, 26.11.2026: the app registers it, so the token
 * and the secret live only in BotFather and Vercel). First the bot is asked
 * who it is (getMe) and its username checked against TELEGRAM_BOT_USERNAME:
 * a mistyped username would send the start link to another bot. Then
 * setWebhook with the secret header and the two update kinds — idempotent,
 * so a new address or a rotated secret is picked up on the next Connect.
 *
 * Production only (Phase 3, decision 13): a bot has one webhook address,
 * and a preview or a laptop must not take it; there it is skipped, and the
 * Start still reaches production's webhook.
 */
export async function registerWebhook(origin: string): Promise<"registered" | "skipped"> {
  if (process.env.VERCEL_ENV !== "production") return "skipped";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new NotifyError("Telegram isn't set up on this server (TELEGRAM_WEBHOOK_SECRET).", false);
  const url = new URL("/api/telegram/webhook", origin);
  if (url.protocol !== "https:") throw new NotifyError(`Telegram needs an https address, not ${url.origin}.`, false);

  const me = await telegramCall<{ username?: string }>("getMe", {});
  const expected = telegramBotUsername();
  if (!expected || me.username?.toLowerCase() !== expected.toLowerCase()) {
    throw new NotifyError(
      `TELEGRAM_BOT_USERNAME is "${expected ?? ""}", but the bot's token belongs to @${me.username ?? "?"}.`,
      false
    );
  }
  await telegramCall<boolean>("setWebhook", {
    url: url.toString(),
    secret_token: secret,
    allowed_updates: TELEGRAM_UPDATES,
  });
  log.info("telegram.webhook_registered", { url: url.toString(), bot: me.username });
  return "registered";
}

