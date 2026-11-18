import { NextRequest, NextResponse } from "next/server";
import { planErrorResponse, planRequestContext, unauthorized } from "@/lib/plans/http";
import { getPlan } from "@/lib/plans/read";
import { planChangesSchema } from "@/lib/plans/schema";
import { changePlan, deletePlan, PlanNotFoundError } from "@/lib/plans/write";

type Params = { params: Promise<{ id: string }> };

// GET /api/plans/[id] — the plan with its days and stops. Routes are a
// separate request per day (…/days/[dayId]/route).
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await planRequestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    const plan = await getPlan(ctx, id);
    if (!plan) throw new PlanNotFoundError();
    return NextResponse.json(plan);
  } catch (e) {
    return planErrorResponse(e, "plans.get");
  }
}

// PATCH /api/plans/[id] — every edit to a plan: { set?, ops? } (see
// src/lib/plans/schema.ts). One request is one transaction. Returns the
// plan as it is afterwards (`plan: null` if it couldn't be read back — the
// change is committed all the same, and the client refetches).
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await planRequestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const parsed = planChangesSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid change" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await changePlan(ctx, id, parsed.data);
  } catch (e) {
    return planErrorResponse(e, "plans.change");
  }
  // Past this point the change is committed: a failed read must not be
  // reported as a failed change.
  const plan = await getPlan(ctx, id).catch(() => null);
  return NextResponse.json({ plan, ...result });
}

// DELETE /api/plans/[id] — removes the plan for good. (Cancelling is a
// PATCH: { set: { status: "cancelled" } }.)
export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await planRequestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    await deletePlan(ctx, id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return planErrorResponse(e, "plans.delete");
  }
}
