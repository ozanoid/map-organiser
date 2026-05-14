import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalize } from "@/lib/ai/normalize";

/**
 * POST /api/user/ai-suggestions/[id]/reject
 *
 * Reject a pending AI proposal. Marks the source row AND all sibling rows
 * (same user + type + normalized value + parent_category_id) as 'rejected'.
 * The user's vocabulary stays untouched; no entities created or modified.
 */
export async function POST(
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

  const { data: source } = await supabase
    .from("ai_suggestions_queue")
    .select("id, type, proposed_value, parent_category_id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  if (source.status !== "pending") {
    return NextResponse.json(
      { error: `Already ${source.status}` },
      { status: 409 }
    );
  }

  const slug = normalize(source.proposed_value);

  // Find siblings (same logical proposal)
  const { data: siblings } = await supabase
    .from("ai_suggestions_queue")
    .select("id, parent_category_id, proposed_value")
    .eq("user_id", user.id)
    .eq("type", source.type)
    .eq("status", "pending");

  const queueIds = (siblings ?? [])
    .filter(
      (r) =>
        normalize(r.proposed_value as string) === slug &&
        (r.parent_category_id ?? null) === (source.parent_category_id ?? null)
    )
    .map((r) => r.id as string);

  if (queueIds.length > 0) {
    const { error } = await supabase
      .from("ai_suggestions_queue")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .in("id", queueIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    rejected_count: queueIds.length,
  });
}
