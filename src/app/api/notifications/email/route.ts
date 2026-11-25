import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/api/origin";
import { errorResponse, unauthorized } from "@/lib/api/http";
import { notifyContext, notOwner } from "@/lib/notify/access";
import { emailAddress, removeEmail, setEmail } from "@/lib/notify/channels";
import { emailConfigured } from "@/lib/notify/config";
import { createServiceClient } from "@/lib/supabase/server";

const Body = z.object({ email: emailAddress }).strict();

/**
 * PUT /api/notifications/email { email } — sets the address and sends its
 * confirmation link (to /confirm-email); nothing else goes to it until the
 * address is confirmed there. Saving the same confirmed address again
 * changes nothing; saving an unconfirmed one again sends a new link.
 */
export async function PUT(req: Request) {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  if (!emailConfigured()) {
    return NextResponse.json({ error: "E-mail isn't set up on this server." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That doesn't look like an e-mail address." }, { status: 400 });

  try {
    const result = await setEmail(createServiceClient(), ctx.userId, parsed.data.email, appOrigin(req));
    if (result.status === "failed") {
      return NextResponse.json({ error: `The confirmation e-mail couldn't be sent: ${result.error}` }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, "notifications.email.set");
  }
}

/** DELETE /api/notifications/email — removes the address. */
export async function DELETE() {
  const ctx = await notifyContext();
  if (!ctx) return unauthorized();
  if (!ctx.owner) return notOwner();
  try {
    await removeEmail(createServiceClient(), ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, "notifications.email.remove");
  }
}
