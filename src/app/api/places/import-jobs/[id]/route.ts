import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PatchSchema = z.object({ status: z.literal("cancelled") });

/**
 * Cancel a running import.
 *
 * `claim_import_items` only claims from jobs whose status is `running`, so
 * flipping the row is enough to stop the drain from taking anything new.
 * Whatever is already in flight finishes its current stage — those places are
 * paid for either way, and leaving them half-enriched helps no one.
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { error } = await supabase
    .from("import_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
