import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { emailConfigured, telegramBotUsername, telegramConfigured } from "@/lib/notify/config";
import { deliver } from "@/lib/notify/outbox";
import { emailVerifyMessage } from "@/lib/notify/render";
import { registerWebhook } from "@/lib/notify/telegram";
import { consumeLinkToken, createLinkToken, hashToken, readLinkToken } from "@/lib/notify/tokens";
import { readSchedule, readTimeZone } from "@/lib/notify/schedule-store";
import type { ChannelKind, NotificationSettingsView } from "@/lib/notify/types";

/**
 * The owner's channels (`notification_channels`): one e-mail address and one
 * Telegram chat. Every write is the server's (service role), scoped to the
 * user here; the table has no write policy.
 *
 * An address is confirmed by a one-time link before anything but that
 * confirmation goes to it — a mistyped address doesn't get someone else's
 * reminders. The link opens a page with a Confirm button (/confirm-email):
 * opening it changes nothing, so a mail scanner that follows links can't
 * confirm an address no one read. A Telegram chat is linked by the bot's
 * start link: the token in it proves the chat belongs to the signed-in user
 * who asked for it.
 */
export interface ChannelRow {
  id: string;
  user_id: string;
  kind: ChannelKind;
  email: string | null;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  verified_at: string | null;
  disabled_at: string | null;
}

const COLUMNS = "id, user_id, kind, email, telegram_chat_id, telegram_username, verified_at, disabled_at";

export const emailAddress = z.string().trim().toLowerCase().max(254).pipe(z.email());

export async function readChannels(
  admin: SupabaseClient,
  userId: string
): Promise<Partial<Record<ChannelKind, ChannelRow>>> {
  const { data, error } = await admin.from("notification_channels").select(COLUMNS).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const out: Partial<Record<ChannelKind, ChannelRow>> = {};
  for (const row of (data ?? []) as ChannelRow[]) out[row.kind] = row;
  return out;
}

/** Something can be sent there: confirmed and not switched off. */
export function usable(row: ChannelRow | undefined): row is ChannelRow {
  return Boolean(row?.verified_at && !row.disabled_at);
}

export async function settingsView(
  admin: SupabaseClient,
  userId: string
): Promise<Extract<NotificationSettingsView, { open: true }>> {
  const [{ email, telegram }, schedule, timeZone] = await Promise.all([
    readChannels(admin, userId),
    readSchedule(admin, userId),
    readTimeZone(admin, userId),
  ]);
  return {
    open: true,
    schedule,
    timeZone,
    email: { configured: emailConfigured(), address: email?.email ?? null, confirmed: Boolean(email?.verified_at) },
    telegram: {
      configured: telegramConfigured(),
      linked: Boolean(telegram),
      username: telegram?.telegram_username ?? null,
      blocked: Boolean(telegram?.disabled_at),
    },
  };
}

// ── E-mail ─────────────────────────────────────────────────────────────

export type SetEmailResult = { status: "sent" } | { status: "already_confirmed" } | { status: "failed"; error: string };

/**
 * Sets the address (unconfirmed while it is new) and sends its confirmation
 * link. The same, already confirmed address is left as it is.
 */
export async function setEmail(
  admin: SupabaseClient,
  userId: string,
  address: string,
  appUrl: string
): Promise<SetEmailResult> {
  const { email: current } = await readChannels(admin, userId);
  if (current?.email === address && current.verified_at) return { status: "already_confirmed" };

  const { error } = await admin.from("notification_channels").upsert(
    {
      user_id: userId,
      kind: "email",
      email: address,
      verified_at: null,
      disabled_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind" }
  );
  if (error) throw new Error(error.message);

  const token = await createLinkToken(admin, userId, "email_verify", address);
  const link = `${appUrl}/confirm-email?token=${token}`;
  const outcome = await deliver(admin, {
    userId,
    kind: "email_verify",
    dedupeKey: `email_verify:${hashToken(token)}`,
    message: emailVerifyMessage(link, appUrl),
    target: { channel: "email", email: address },
    // The record keeps a copy of the e-mail; the token stays only in the link.
    secrets: [token],
  });
  if (outcome.status === "failed") return { status: "failed", error: outcome.error };
  return { status: "sent" };
}

export type EmailLinkState =
  | { state: "ready"; email: string } // can be confirmed
  | { state: "confirmed"; email: string } // the address is confirmed (by this link or another)
  | { state: "invalid" }; // unknown, used, expired, or the address changed since

/** Where a confirmation link stands — read only; the page shows it before
 *  the user presses Confirm. */
export async function emailLinkState(admin: SupabaseClient, token: string): Promise<EmailLinkState> {
  const row = await readLinkToken(admin, token, "email_verify");
  if (!row?.email) return { state: "invalid" };
  const { email: channel } = await readChannels(admin, row.user_id);
  // The address was changed or removed since: this link confirms nothing.
  if (channel?.email !== row.email) return { state: "invalid" };
  if (channel.verified_at) return { state: "confirmed", email: row.email };
  if (row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return { state: "invalid" };
  return { state: "ready", email: row.email };
}

/** Confirm pressed: confirms the address the token was made for — if the
 *  user changed it since, the old link confirms nothing. Pressed twice, or
 *  on a link to an address already confirmed, it answers "confirmed". */
export async function confirmEmail(admin: SupabaseClient, token: string): Promise<"confirmed" | "invalid"> {
  const used = await consumeLinkToken(admin, token, "email_verify");
  if (used?.email) {
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("notification_channels")
      .update({ verified_at: now, disabled_at: null, updated_at: now })
      .eq("user_id", used.user_id)
      .eq("kind", "email")
      .eq("email", used.email)
      .select("id");
    if (error) throw new Error(error.message);
    if (data && data.length > 0) return "confirmed";
  }
  return (await emailLinkState(admin, token)).state === "confirmed" ? "confirmed" : "invalid";
}

export async function removeEmail(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from("notification_channels").delete().eq("user_id", userId).eq("kind", "email");
  if (error) throw new Error(error.message);
}

// ── Telegram ───────────────────────────────────────────────────────────

/** The bot's start link carrying a one-time token (15 minutes), the bot
 *  pointed at this deployment first. */
export async function telegramStartLink(admin: SupabaseClient, userId: string, origin: string): Promise<string> {
  const bot = telegramBotUsername();
  if (!bot) throw new Error("Telegram isn't set up on this server.");
  // The Start must reach this deployment: the bot is pointed at its webhook
  // first (production only — registerWebhook).
  await registerWebhook(origin);
  const token = await createLinkToken(admin, userId, "telegram_link");
  return `https://t.me/${bot}?start=${token}`;
}

export type LinkResult = "linked" | "invalid" | "taken";

/** `/start <token>` from a private chat: links that chat to the token's
 *  user. The same chat with the same link again — Start tapped twice, or
 *  Telegram delivering the update a second time — answers "linked" again. */
export async function linkTelegram(
  admin: SupabaseClient,
  token: string,
  chat: { id: number; username: string | null }
): Promise<LinkResult> {
  const used = await consumeLinkToken(admin, token, "telegram_link");
  if (!used) {
    const seen = await readLinkToken(admin, token, "telegram_link");
    if (!seen?.used_at) return "invalid";
    const { telegram } = await readChannels(admin, seen.user_id);
    return telegram && Number(telegram.telegram_chat_id) === chat.id ? "linked" : "invalid";
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("notification_channels").upsert(
    {
      user_id: used.user_id,
      kind: "telegram",
      telegram_chat_id: chat.id,
      telegram_username: chat.username,
      verified_at: now,
      disabled_at: null,
      updated_at: now,
    },
    { onConflict: "user_id,kind" }
  );
  if (error) {
    // The chat is linked to another account (one chat, one account).
    if (error.code === "23505") return "taken";
    throw new Error(error.message);
  }
  return "linked";
}

export async function unlinkTelegram(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from("notification_channels").delete().eq("user_id", userId).eq("kind", "telegram");
  if (error) throw new Error(error.message);
}

/** The user blocked the bot (or unblocked it): nothing goes to a blocked chat. */
export async function setTelegramBlocked(admin: SupabaseClient, chatId: number, blocked: boolean): Promise<void> {
  const { error } = await admin
    .from("notification_channels")
    .update({ disabled_at: blocked ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("kind", "telegram")
    .eq("telegram_chat_id", chatId);
  if (error) throw new Error(error.message);
}
