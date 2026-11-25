import "server-only";
import { z } from "zod";
import { NotFoundError } from "@/lib/db/errors";
import { ToolInputError } from "@/lib/assistant/library";
import { defineTool } from "@/lib/assistant/tools/types";
import { sendPlanToOwner } from "@/lib/notify/send";
import type { ChannelKind, ChannelResult } from "@/lib/notify/types";

const CHANNEL: Record<ChannelKind, string> = { email: "e-mail", telegram: "Telegram" };

/**
 * The tool's answer from the per-channel results. Something went: where it
 * went and what didn't. Nothing went: an error result — the model can't
 * report a send that didn't happen, and the card says it couldn't send.
 */
export function planSendOutcome(sent: { plan: { name: string; url: string }; results: ChannelResult[] }) {
  const ok = sent.results.filter((r) => r.status === "sent" || r.status === "busy");
  const notConnected = sent.results.filter((r) => r.status === "not_connected").map((r) => r.channel);
  const failed = sent.results.filter((r) => r.status === "failed");
  if (ok.length === 0) {
    const why = [
      ...notConnected.map((c) => `${CHANNEL[c]} isn't connected`),
      ...failed.map((r) => `${CHANNEL[r.channel]} failed (${r.error ?? "no reason given"})`),
    ];
    throw new ToolInputError(
      why.length === 0
        ? "Nothing was sent: the user has no channel connected. E-mail or Telegram is connected in the app under Settings → Notifications."
        : `Nothing was sent: ${why.join("; ")}.${notConnected.length ? " A channel is connected in the app under Settings → Notifications." : ""}`
    );
  }
  return {
    plan: { name: sent.plan.name, url: sent.plan.url },
    sent: ok.map((r) => ({ channel: r.channel, to: r.to })),
    not_connected: notConnected.length ? notConnected : undefined,
    failed: failed.length ? failed.map((r) => ({ channel: r.channel, error: r.error })) : undefined,
  };
}

export const sendPlanTool = defineTool({
  name: "send_plan",
  title: "Send a plan to the user",
  description:
    "Send one of the user's plans (plan_id from get_plans) to the user themself — their e-mail and/or Telegram, connected in the app under Settings → Notifications — as a summary of its days, stops, times, notes and map links, written in Turkish. It reaches no one else. Leave channels out to use every connected one. A channel that isn't connected is reported, not sent: tell the user to connect it in Settings → Notifications.",
  inputSchema: z.object({
    plan_id: z.uuid().describe("The plan to send (from get_plans)"),
    channels: z
      .array(z.enum(["email", "telegram"]))
      .min(1)
      .max(2)
      .optional()
      .describe("Where to send it; default every channel the user has connected"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, input) {
    try {
      return planSendOutcome(await sendPlanToOwner(ctx, input.plan_id, input.channels));
    } catch (e) {
      if (e instanceof NotFoundError) throw new ToolInputError("No plan with that plan_id — get_plans lists them.");
      throw e;
    }
  },
});
