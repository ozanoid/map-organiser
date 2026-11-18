import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { autoPlanStops } from "@/lib/plans/write";

// POST /api/plans/[id]/auto-plan — spread the plan's places across its days
// by geography. Returns the plan as it is afterwards.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    return NextResponse.json({ plan: await autoPlanStops(ctx, id) });
  } catch (e) {
    return errorResponse(e, "plans.auto-plan");
  }
}
