import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/user/ai-suggestions
 *
 * Lists pending AI proposals for the moderation queue (Phase 5 UI).
 * Joined with `places(name)` and `categories(name)` so the UI can render
 * meaningful context next to each proposal (which place suggested this tag,
 * which parent category for the sub-category).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ai_suggestions_queue")
    .select(
      "id, type, proposed_value, parent_category_id, confidence, status, created_at, place_id, places(name), categories!ai_suggestions_queue_parent_category_id_fkey(name)"
    )
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by (type, lower(proposed_value), parent_category_id) so the same
  // tag/sub-cat proposed by multiple places shows as one row with a count.
  const grouped = new Map<
    string,
    {
      key: string;
      type: "tag" | "subcategory";
      proposed_value: string;
      parent_category_id: string | null;
      parent_category_name: string | null;
      confidence: number;
      occurrences: number;
      latest_at: string;
      sample_place_name: string | null;
      ids: string[];
    }
  >();

  for (const row of data ?? []) {
    const r = row as {
      id: string;
      type: "tag" | "subcategory";
      proposed_value: string;
      parent_category_id: string | null;
      confidence: number;
      created_at: string;
      places: { name?: string } | null;
      categories: { name?: string } | null;
    };
    const key = `${r.type}::${r.proposed_value.toLowerCase()}::${r.parent_category_id ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.ids.push(r.id);
      // Keep the highest confidence seen
      if (r.confidence > existing.confidence) existing.confidence = r.confidence;
    } else {
      grouped.set(key, {
        key,
        type: r.type,
        proposed_value: r.proposed_value,
        parent_category_id: r.parent_category_id,
        parent_category_name: r.categories?.name ?? null,
        confidence: r.confidence,
        occurrences: 1,
        latest_at: r.created_at,
        sample_place_name: r.places?.name ?? null,
        ids: [r.id],
      });
    }
  }

  return NextResponse.json({
    suggestions: Array.from(grouped.values()).sort(
      (a, b) => b.occurrences - a.occurrences
    ),
  });
}
