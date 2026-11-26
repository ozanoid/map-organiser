import { NextResponse } from "next/server";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { timeZoneInput } from "@/lib/notify/schedule-store";

/**
 * PUT /api/user/time-zone { timeZone, auto? } — the user's IANA time zone
 * (profiles.time_zone, Phase 3 slice 2), written with their own session like
 * the rest of the profile. `auto`: the browser's zone, sent once per device
 * — kept only while none is set, so a zone chosen in Settings stays. Returns
 * the zone now on the profile.
 */
export async function PUT(req: Request) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const parsed = timeZoneInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a time zone." }, { status: 400 });
  const { timeZone, auto } = parsed.data;
  try {
    let update = ctx.supabase.from("profiles").update({ time_zone: timeZone, updated_at: new Date().toISOString() }).eq("id", ctx.userId);
    if (auto) update = update.is("time_zone", null);
    const { error } = await update;
    if (error) throw new Error(error.message);
    const { data, error: readError } = await ctx.supabase.from("profiles").select("time_zone").eq("id", ctx.userId).maybeSingle();
    if (readError) throw new Error(readError.message);
    return NextResponse.json({ timeZone: (data as { time_zone: string | null } | null)?.time_zone ?? null });
  } catch (e) {
    return errorResponse(e, "user.time_zone");
  }
}
