import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { listPlans } from "@/lib/plans/read";
import { MAX_PLAN_DAYS } from "@/lib/plans/schema";
import { createPlan, stopsFromList } from "@/lib/plans/write";

// GET /api/plans — the user's plans, without days or stops.
export async function GET() {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  try {
    return NextResponse.json(await listPlans(ctx));
  } catch (e) {
    return errorResponse(e, "plans.list");
  }
}

// POST /api/plans — create a plan with empty days. A start date is optional
// (a plan can be scheduled later). With `list_id` the list's places become
// the stops of day 1, ready to be spread over the days with Auto Plan.
const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  start_date: z.iso.date().nullable().optional(),
  day_count: z.number().int().min(1).max(MAX_PLAN_DAYS).default(1),
  list_id: z.uuid().optional(),
});

export async function POST(request: NextRequest) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "A plan needs a name and 1 or more days" }, { status: 400 });
  }
  const { name, start_date, day_count, list_id } = parsed.data;

  try {
    const firstDayStops = list_id ? await stopsFromList(ctx, list_id) : [];
    const id = await createPlan(
      ctx,
      {
        name,
        start_date: start_date ?? null,
        list_id,
        days: Array.from({ length: day_count }, (_, i) => (i === 0 ? { stops: firstDayStops } : {})),
      },
      { createdVia: "app" }
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return errorResponse(e, "plans.create");
  }
}
