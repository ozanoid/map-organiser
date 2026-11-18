import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requestContext, unauthorized } from "@/lib/api/http";
import { getList } from "@/lib/lists/read";
import { listChangesSchema } from "@/lib/lists/schema";
import { changeList, deleteList, ListNotFoundError } from "@/lib/lists/write";

type Params = { params: Promise<{ id: string }> };

// GET /api/lists/[id] — the list with its places in order: each item's
// place id, position and note. The places themselves come from
// /api/places?list_id=… (the cards and the map need the full rows).
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    const list = await getList(ctx, id);
    if (!list) throw new ListNotFoundError();
    return NextResponse.json(list);
  } catch (e) {
    return errorResponse(e, "lists.get");
  }
}

// PATCH /api/lists/[id] — { set?, ops? } (listChangesSchema in
// src/lib/lists/schema.ts): rename, describe, add / remove / move places,
// notes, a new order. One request is one transaction. Returns the list as it
// is afterwards (`list: null` if it couldn't be read back — the change is
// committed all the same, and the client refetches).
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const parsed = listChangesSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  }

  let result;
  try {
    result = await changeList(ctx, id, parsed.data);
  } catch (e) {
    return errorResponse(e, "lists.change");
  }
  // Committed: a failed read must not be reported as a failed change.
  const list = await getList(ctx, id).catch(() => null);
  return NextResponse.json({ list, ...result });
}

// DELETE /api/lists/[id] — removes the list for good; its places stay.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    await deleteList(ctx, id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return errorResponse(e, "lists.delete");
  }
}
