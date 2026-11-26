import "server-only";
import { Resend } from "resend";
import { emailSender, resendApiKey } from "@/lib/notify/config";
import { NotifyError } from "@/lib/notify/errors";
import { SENDER_NAME } from "@/lib/notify/render";

/**
 * E-mail through Resend (docs/04-integrations/resend.md): RESEND_API_KEY and
 * the sender in EMAIL_FROM — an address on the domain verified in Resend
 * (hello@mappy.site), or "Name <address>". Open and click tracking stay off
 * (they're per domain in Resend; we never turn them on).
 */
let client: Resend | null = null;

function resend(): Resend {
  const key = resendApiKey();
  if (!key) throw new NotifyError("E-mail isn't set up on this server (RESEND_API_KEY).", false);
  client ??= new Resend(key);
  return client;
}

/** The From header: EMAIL_FROM as it is when it names the sender
 *  ("Name <address>"), else the bare address under SENDER_NAME ("Mappy"). */
export function fromHeader(raw: string): string {
  const value = raw.trim();
  return value.includes("<") ? value : `${SENDER_NAME} <${value}>`;
}

/** Resend's codes a later attempt may get past. */
const RETRYABLE = new Set(["rate_limit_exceeded", "daily_quota_exceeded", "application_error", "internal_server_error", "concurrent_idempotent_requests"]);

/**
 * Sends one e-mail; returns Resend's message id. The idempotency key makes a
 * retry of the same record within 24 hours a no-op at Resend — a send that
 * went out but whose result never came back isn't sent twice.
 */
export async function sendEmail(
  message: { to: string; subject: string; html: string; text: string },
  idempotencyKey: string
): Promise<string> {
  const sender = emailSender();
  if (!sender) throw new NotifyError("E-mail isn't set up on this server (EMAIL_FROM).", false);
  const from = fromHeader(sender);
  let result;
  try {
    result = await resend().emails.send(
      { from, to: message.to, subject: message.subject, html: message.html, text: message.text },
      { idempotencyKey }
    );
  } catch (e) {
    // The request itself failed (network): worth another try.
    throw new NotifyError(`E-mail: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  if (result.error) {
    throw new NotifyError(`E-mail: ${result.error.message}`, RETRYABLE.has(result.error.name));
  }
  if (!result.data?.id) throw new NotifyError("E-mail: no message id came back.", true);
  return result.data.id;
}
