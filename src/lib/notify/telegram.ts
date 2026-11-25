import "server-only";
import { NotifyError, TelegramChatGone } from "@/lib/notify/errors";

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
