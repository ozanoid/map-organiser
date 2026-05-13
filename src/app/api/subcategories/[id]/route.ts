import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PatchBodySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    is_pending: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.is_pending !== undefined,
    { message: "At least one field is required" }
  );

/**
 * PATCH /api/subcategories/[id]
 *
 * Updates name or flips is_pending → false (used by Phase 5 to approve a
 * pending AI proposal). RLS enforces ownership.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.is_pending !== undefined) {
    update.is_pending = parsed.data.is_pending;
    if (parsed.data.is_pending === false) {
      update.approved_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from("subcategories")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ subcategory: data });
}

/**
 * DELETE /api/subcategories/[id]
 *
 * Deletes a subcategory. Places referencing it fall back to category-only
 * classification (ON DELETE SET NULL on places.subcategory_id).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.from("subcategories").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
