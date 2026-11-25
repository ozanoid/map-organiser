import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/db/errors";
import type { UserContext } from "@/lib/db/context";
import { readChannels, setTelegramBlocked, usable } from "@/lib/notify/channels";
import { emailConfigured, telegramConfigured } from "@/lib/notify/config";
import { deliver } from "@/lib/notify/outbox";
import { channelTestMessage, planSummaryMessage } from "@/lib/notify/render";
import { CHANNEL_KINDS, type ChannelKind, type ChannelResult, type Message, type NotificationKind } from "@/lib/notify/types";
import { getPlan } from "@/lib/plans/read";
import { createServiceClient } from "@/lib/supabase/server";

const configured = (channel: ChannelKind) => (channel === "email" ? emailConfigured() : telegramConfigured());

/**
 * One message to the owner's own channels — the ones asked for, or every
 * connected one. A channel that isn't connected (or isn't set up on this
 * server) is reported, not an error. Each channel is its own record.
 */
export async function sendToOwner(
  admin: SupabaseClient,
  args: {
    userId: string;
    kind: NotificationKind;
    planId?: string | null;
    /** The record's key; the channel is appended. */
    key: string;
    message: Message;
    channels?: readonly ChannelKind[];
  }
): Promise<ChannelResult[]> {
  const rows = await readChannels(admin, args.userId);
  const wanted = args.channels ?? CHANNEL_KINDS.filter((k) => usable(rows[k]) && configured(k));
  return Promise.all(
    [...new Set(wanted)].map(async (channel): Promise<ChannelResult> => {
      const row = rows[channel];
      if (!usable(row) || !configured(channel)) return { channel, status: "not_connected" };
      const to = channel === "email" ? row.email! : row.telegram_username ? `@${row.telegram_username}` : "Telegram";
      const outcome = await deliver(admin, {
        userId: args.userId,
        kind: args.kind,
        planId: args.planId ?? null,
        dedupeKey: `${args.key}:${channel}`,
        message: args.message,
        target:
          channel === "email"
            ? { channel: "email", email: row.email! }
            : { channel: "telegram", chatId: Number(row.telegram_chat_id), username: row.telegram_username },
      });
      if (outcome.status === "failed") {
        if (outcome.chatGone) await setTelegramBlocked(admin, Number(row.telegram_chat_id), true);
        return { channel, status: "failed", to, error: outcome.error };
      }
      return { channel, status: outcome.status, to };
    })
  );
}

/** "Send to me": a plan's summary to the owner (the plan page, send_plan). */
export async function sendPlanToOwner(
  ctx: UserContext & { appUrl: string },
  planId: string,
  channels?: readonly ChannelKind[]
): Promise<{ plan: { id: string; name: string; url: string }; results: ChannelResult[] }> {
  const plan = await getPlan(ctx, planId);
  if (!plan) throw new NotFoundError("Plan not found");
  const results = await sendToOwner(createServiceClient(), {
    userId: ctx.userId,
    kind: "plan_summary",
    planId: plan.id,
    key: `plan_summary:${plan.id}:${randomUUID()}`,
    message: planSummaryMessage(plan, ctx.appUrl),
    channels,
  });
  return { plan: { id: plan.id, name: plan.name, url: `${ctx.appUrl}/plans/${plan.id}` }, results };
}

/** Settings' "Send test" for one channel. */
export async function sendChannelTest(
  userId: string,
  channel: ChannelKind,
  appUrl: string
): Promise<ChannelResult> {
  const [result] = await sendToOwner(createServiceClient(), {
    userId,
    kind: "channel_test",
    key: `channel_test:${randomUUID()}`,
    message: channelTestMessage(appUrl),
    channels: [channel],
  });
  return result;
}
