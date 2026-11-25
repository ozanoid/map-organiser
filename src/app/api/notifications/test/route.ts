import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/api/origin";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { sendChannelTest } from "@/lib/notify/send";

const Body = z.object({ channel: z.enum(["email", "telegram"]) }).strict();

/** POST /api/notifications/test { channel } — Settings' "Send test". */
export async function POST(req: Request) {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const result = await sendChannelTest(ctx.userId, parsed.data.channel, appOrigin(req));
    if (result.status === "not_connected") {
      return NextResponse.json({ error: "That channel isn't connected." }, { status: 409 });
    }
    if (result.status === "failed") return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, "notifications.test");
  }
}
