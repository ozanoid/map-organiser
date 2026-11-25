import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notify/email";
import { NotifyError, TelegramChatGone } from "@/lib/notify/errors";
import { sendTelegram } from "@/lib/notify/telegram";
import type { ChannelKind, Message, NotificationKind } from "@/lib/notify/types";
import { log } from "@/lib/telemetry/logger";

/**
 * The record of what the app sends (`notifications`): a row is written first
 * (its dedupe key unique — the same message can't be written twice), held by
 * one sender (`notification_claim`), sent, and marked with how it went and a
 * copy of what went out. A later attempt — the scheduler's, in slice 2 —
 * picks up a failed row, or one whose sender died mid-send once its hold
 * lapses; Resend's idempotency key keeps a retry within 24 hours from
 * sending an e-mail twice.
 */
export interface Delivery {
  userId: string;
  kind: NotificationKind;
  planId?: string | null;
  dedupeKey: string;
  message: Message;
  target: { channel: "email"; email: string } | { channel: "telegram"; chatId: number; username: string | null };
}

export type DeliveryOutcome =
  | { status: "sent" }
  | { status: "busy" } // another sender holds it, or it went out before
  | { status: "failed"; error: string; chatGone?: boolean };

const LEASE_SECONDS = 60;

/** The two providers. */
export interface Senders {
  email: typeof sendEmail;
  telegram: typeof sendTelegram;
}
const PROVIDERS: Senders = { email: sendEmail, telegram: sendTelegram };
let senders: Senders = PROVIDERS;

/** The offline checks (scripts/notify-check) send through stand-ins; null
 *  puts the providers back. Nothing in the app calls it. */
export function setSenders(next: Senders | null): void {
  senders = next ?? PROVIDERS;
}

function recipient(target: Delivery["target"]): string {
  return target.channel === "email" ? target.email : target.username ? `@${target.username}` : String(target.chatId);
}

export async function deliver(admin: SupabaseClient, d: Delivery): Promise<DeliveryOutcome> {
  const channel: ChannelKind = d.target.channel;

  // 1. The record. A dedupe key seen before means this message was written
  //    already: it is sent (or being sent) once, not again.
  let id: string | undefined;
  const { data: inserted, error: insertError } = await admin
    .from("notifications")
    .insert({ user_id: d.userId, kind: d.kind, channel, plan_id: d.planId ?? null, dedupe_key: d.dedupeKey })
    .select("id")
    .maybeSingle();
  if (insertError) {
    if (insertError.code !== "23505") throw new Error(insertError.message);
    const { data: existing, error } = await admin
      .from("notifications")
      .select("id, status")
      .eq("dedupe_key", d.dedupeKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing || existing.status === "sent") return { status: "busy" };
    id = existing.id as string;
  } else {
    id = (inserted as { id: string }).id;
  }

  // 2. Hold it.
  const { data: claimed, error: claimError } = await admin.rpc("notification_claim", {
    p_id: id,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimError) throw new Error(claimError.message);
  if (!Array.isArray(claimed) || claimed.length === 0) return { status: "busy" };

  // 3. Send, and record how it went.
  const content = { to: recipient(d.target), subject: d.message.subject, text: d.message.text };
  try {
    const providerId =
      d.target.channel === "email"
        ? await senders.email(
            { to: d.target.email, subject: d.message.subject, html: d.message.html, text: d.message.text },
            `notification-${id}`
          )
        : await senders.telegram(d.target.chatId, d.message.telegram);
    const { error } = await admin
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: providerId,
        claimed_until: null,
        last_error: null,
        content,
      })
      .eq("id", id);
    if (error) log.warn("notify.record_sent_failed", { id, error: error.message });
    return { status: "sent" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { error } = await admin
      .from("notifications")
      .update({ status: "failed", claimed_until: null, last_error: message.slice(0, 500), content })
      .eq("id", id);
    if (error) log.warn("notify.record_failed_failed", { id, error: error.message });
    log.warn("notify.send_failed", {
      id,
      kind: d.kind,
      channel,
      error: message,
      retryable: e instanceof NotifyError ? e.retryable : true,
    });
    return { status: "failed", error: message, chatGone: e instanceof TelegramChatGone };
  }
}
