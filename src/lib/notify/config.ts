import "server-only";

/**
 * The notification settings, read in one place. Every value is trimmed: a key
 * pasted into Vercel with a space or a line break around it still works —
 * Telegram answers a token with a trailing space with a bare "Not Found"
 * (measured 26.11.2026).
 */
function setting(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export const resendApiKey = () => setting("RESEND_API_KEY");
export const emailSender = () => setting("EMAIL_FROM");
export const telegramToken = () => setting("TELEGRAM_BOT_TOKEN");
export const telegramWebhookSecret = () => setting("TELEGRAM_WEBHOOK_SECRET");

/** The server can send e-mail: Resend's key and the From address. */
export function emailConfigured(): boolean {
  return Boolean(resendApiKey() && emailSender());
}

/** The server has a Telegram bot: its token and its username (for links). */
export function telegramConfigured(): boolean {
  return Boolean(telegramToken() && telegramBotUsername());
}

/** The bot's username without the @, or null. */
export function telegramBotUsername(): string | null {
  return setting("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "") || null;
}

/** BotFather's token: the bot's id, a colon, then about 35 characters. */
const TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]{30,}$/;
/** What Telegram accepts as a webhook's secret_token. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * What is wrong with the Telegram settings, or null — in words that name the
 * variable and never show its value. Checked before Telegram is called:
 * Telegram answers a malformed token with "Not Found", which names nothing.
 */
export function telegramSettingsProblem(): string | null {
  const token = telegramToken();
  const username = telegramBotUsername();
  if (!token) return "TELEGRAM_BOT_TOKEN isn't set.";
  if (!TOKEN_SHAPE.test(token)) {
    const looks: string[] = [];
    if (username && token.replace(/^@/, "").toLowerCase() === username.toLowerCase()) looks.push("it holds the bot's username");
    else if (/^[0-9a-f]{64}$/i.test(token)) looks.push("it looks like the webhook secret");
    else {
      if (/^["'`]|["'`]$/.test(token)) looks.push("it has quotes around it");
      if (/^bot/i.test(token)) looks.push('it starts with "bot"');
      if (/\s/.test(token)) looks.push("it has a space inside");
      if (!token.includes(":")) looks.push("it has no colon");
    }
    return `TELEGRAM_BOT_TOKEN isn't a BotFather token — that is the bot's number, a colon and about 35 letters and digits (123456789:AAH…)${looks.length ? `; ${looks.join(", ")}` : ""}.`;
  }
  if (!username) return "TELEGRAM_BOT_USERNAME isn't set.";
  const secret = telegramWebhookSecret();
  if (!secret) return "TELEGRAM_WEBHOOK_SECRET isn't set.";
  if (!SECRET_SHAPE.test(secret)) return "TELEGRAM_WEBHOOK_SECRET may hold only A–Z, a–z, 0–9, _ and - (up to 256 characters).";
  return null;
}
