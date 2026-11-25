/** A send that didn't go through. `retryable`: a later attempt may succeed
 *  (rate limit, the provider's own error); otherwise it won't (bad input). */
export class NotifyError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Seconds to wait, when the provider said (Telegram's retry_after). */
    readonly retryAfterS?: number
  ) {
    super(message);
    this.name = "NotifyError";
  }
}

/** Telegram answered 403: the user blocked the bot or the chat is gone.
 *  The channel is switched off until it is linked again. */
export class TelegramChatGone extends NotifyError {
  constructor(message: string) {
    super(message, false);
    this.name = "TelegramChatGone";
  }
}
