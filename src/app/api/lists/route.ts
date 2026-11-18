import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { listLists } from "@/lib/lists/read";
import { listCreateSchema } from "@/lib/lists/schema";
import { createList } from "@/lib/lists/write";

// GET /api/lists — the user's lists with their place counts, newest first.
export async function GET() {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  try {
    return NextResponse.json(await listLists(ctx));
  } catch (e) {
    return errorResponse(e, "lists.list");
  }
}

// POST /api/lists — a new list: { name, description?, color? } → 201 { id }.
export async function POST(request: NextRequest) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const parsed = listCreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A list needs a name" }, { status: 400 });
  }
  try {
    const result = await createList(ctx, parsed.data, { createdVia: "app" });
    return NextResponse.json({ id: result.list_id }, { status: 201 });
  } catch (e) {
    return errorResponse(e, "lists.create");
  }
}
