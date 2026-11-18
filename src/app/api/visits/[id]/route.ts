import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { visitEditSchema } from "@/lib/visits/schema";
import { deleteVisit, editVisit } from "@/lib/visits/write";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/visits/[id] — correct a visit: { visited_on?, rating?, notes? }
// (null clears rating and notes). Returns { visit, created: false, place }.
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  const parsed = visitEditSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  }
  try {
    return NextResponse.json(await editVisit(ctx, id, parsed.data));
  } catch (e) {
    return errorResponse(e, "visits.edit");
  }
}

// DELETE /api/visits/[id] — removes the visit for good. A stop it fulfilled
// is planned again; the place stays marked visited. Returns
// { place, reopened_stop_id }.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    return NextResponse.json(await deleteVisit(ctx, id));
  } catch (e) {
    return errorResponse(e, "visits.delete");
  }
}
