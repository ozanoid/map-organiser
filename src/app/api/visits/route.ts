import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { listVisits } from "@/lib/visits/read";
import { visitLogSchema } from "@/lib/visits/schema";
import { logVisit } from "@/lib/visits/write";

// GET /api/visits?place_id=…&from=…&to=…&limit=… — the user's visits,
// newest first.
const ListSchema = z.object({
  place_id: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: NextRequest) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const parsed = ListSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  const { place_id, from, to, limit } = parsed.data;
  try {
    return NextResponse.json(
      await listVisits(ctx, { placeIds: place_id ? [place_id] : undefined, from, to, limit })
    );
  } catch (e) {
    return errorResponse(e, "visits.list");
  }
}

// POST /api/visits — log a visit (or update the place's visit that day).
// Returns { visit, created, place } — `place` is the place's visit status
// and rating afterwards.
export async function POST(request: NextRequest) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const parsed = visitLogSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid visit" }, { status: 400 });
  }
  try {
    const result = await logVisit(ctx, parsed.data, { createdVia: "app" });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    return errorResponse(e, "visits.log");
  }
}
