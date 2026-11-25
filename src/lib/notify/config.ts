import "server-only";

/** The server can send e-mail: Resend's key and the From address. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** The server has a Telegram bot: its token and its username (for links). */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && telegramBotUsername());
}

/** The bot's username without the @, or null. */
export function telegramBotUsername(): string | null {
  return process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
}
