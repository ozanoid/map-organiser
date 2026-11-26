/**
 * Phase 3 (docs/_plans/phase-3-communication.md): what the app sends the
 * owner and where. Shared with the browser — no server-only imports here.
 */

import type { ScheduleSettings } from "@/lib/notify/schedule";

export type ChannelKind = "email" | "telegram";
export const CHANNEL_KINDS: readonly ChannelKind[] = ["email", "telegram"];

/** A row's kind in `notifications` (the migration's CHECK lists the same). */
export type NotificationKind =
  | "email_verify"
  | "channel_test"
  | "plan_summary"
  | "plan_reminder"
  | "weekly_summary"
  | "rsvp_received";

/** One message, rendered for every channel. */
export interface Message {
  /** The e-mail's subject. */
  subject: string;
  /** Plain text: the e-mail's text part and the record's copy. */
  text: string;
  /** The e-mail's HTML. */
  html: string;
  /** Telegram's HTML subset (b, i, a). */
  telegram: string;
}

/** The owner's two channels, as Settings → Notifications shows them. */
export interface ChannelsView {
  email: {
    /** The server can send e-mail (RESEND_API_KEY, EMAIL_FROM). */
    configured: boolean;
    address: string | null;
    /** Its confirmation link was opened. */
    confirmed: boolean;
  };
  telegram: {
    /** The server has a bot (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME). */
    configured: boolean;
    linked: boolean;
    username: string | null;
    /** The bot was blocked in Telegram: nothing goes there until it is linked again. */
    blocked: boolean;
  };
}

/**
 * GET /api/notifications. `open: false` — the account isn't the app's owner
 * (ASSISTANT_OWNER_EMAILS): in v1 the app sends only to the owner (Phase 3,
 * decision 7), so there is nothing to set up.
 */
export type NotificationSettingsView =
  | { open: false }
  | ({
      open: true;
      /** Reminders and the weekly summary (Phase 3, slice 2). */
      schedule: ScheduleSettings;
      /** The user's IANA time zone, or null until the browser has said it. */
      timeZone: string | null;
    } & ChannelsView);

/** How a send to one channel went (POST /api/plans/[id]/send, send_plan). */
export interface ChannelResult {
  channel: ChannelKind;
  status: "sent" | "failed" | "not_connected" | "busy";
  /** Where it went: the address, or the Telegram username. */
  to?: string;
  error?: string;
}
