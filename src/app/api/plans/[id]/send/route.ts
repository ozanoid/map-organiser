import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/api/origin";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { sendPlanToOwner } from "@/lib/notify/send";

const Body = z
  .object({ channels: z.array(z.enum(["email", "telegram"])).min(1).max(2).optional() })
  .strict();

/**
 * POST /api/plans/[id]/send { channels? } — "Send to me": the plan's
 * summary to the owner's own e-mail and/or Telegram (every connected one
 * when `channels` is left out). Each channel answers for itself:
 * `{ plan, results: ChannelResult[] }`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(
      await sendPlanToOwner({ supabase: ctx.supabase, userId: ctx.userId, appUrl: appOrigin(req) }, id, parsed.data.channels)
    );
  } catch (e) {
    return errorResponse(e, "plans.send");
  }
}
