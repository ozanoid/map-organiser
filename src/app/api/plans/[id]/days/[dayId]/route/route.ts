import { NextRequest, NextResponse, after } from "next/server";
import { trackUsage } from "@/lib/google/track-usage";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { dayRoute, getPlan, RouteUnavailableError } from "@/lib/plans/read";
import { routeSignature } from "@/lib/plans/route-signature";
import { PlanNotFoundError } from "@/lib/plans/write";

// GET /api/plans/[id]/days/[dayId]/route?sig=… — the day's route through its
// stops that have a place (Mapbox Directions), or { route: null } when the
// day has fewer than two.
//
// The coordinates come from the database, not from the request, so this
// can't be used as a Directions proxy. The client caches the answer under
// the day's signature (its located stops in order + the profile, see
// routeSignature) and sends that signature along: if the day read here has
// a different one — the plan changed between the client's render and this
// request — the answer is 409, never a route for another arrangement stored
// under the old key. A change that doesn't move a stop — a cost, a note, the
// party size — keeps the signature and asks for no new route.
//
// 502 when Mapbox gives no route: an error is retried and not cached; a
// 200 with null would be remembered as "this day has no route".
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id, dayId } = await params;
  const expected = request.nextUrl.searchParams.get("sig");
  try {
    const plan = await getPlan(ctx, id);
    const day = plan?.days?.find((d) => d.id === dayId);
    if (!day) throw new PlanNotFoundError();
    if (expected !== null && expected !== (routeSignature(day) ?? "")) {
      return NextResponse.json({ error: "The day changed — ask again" }, { status: 409 });
    }
    const route = await dayRoute(day, () =>
      // after(): a loose promise can be frozen with the serverless instance.
      after(() => trackUsage(ctx.userId, "mapbox_directions", ctx.supabase).catch(() => {}))
    );
    return NextResponse.json({ route });
  } catch (e) {
    if (e instanceof RouteUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return errorResponse(e, "plans.route");
  }
}
