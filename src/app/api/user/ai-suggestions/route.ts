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

  // Two joins on categories: one for parent_category_id (sub-cat proposals)
  // and another logical use of target_category_name (string, no FK).
  // For sample_place_category_name (the place's CURRENT category, used by
  // the UI to render "moves from X") we walk via places → categories.
  const { data, error } = await supabase
    .from("ai_suggestions_queue")
    .select(
      "id, type, proposed_value, parent_category_id, target_category_name, confidence, status, created_at, place_id, places(name, category_id, categories(name)), categories!ai_suggestions_queue_parent_category_id_fkey(name)"
    )
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type SuggestionGroup = {
    key: string;
    type: "tag" | "subcategory" | "category_change";
    proposed_value: string;
    parent_category_id: string | null;
    parent_category_name: string | null;
    target_category_name: string | null;
    /** The place's currently assigned category name — populated when the
     *  proposal implies a move (target_category_name set AND it differs). */
    sample_place_category_name: string | null;
    confidence: number;
    occurrences: number;
    latest_at: string;
    sample_place_name: string | null;
    ids: string[];
  };

  const grouped = new Map<string, SuggestionGroup>();

  for (const row of data ?? []) {
    const r = row as {
      id: string;
      type: "tag" | "subcategory" | "category_change";
      proposed_value: string;
      parent_category_id: string | null;
      target_category_name: string | null;
      confidence: number;
      created_at: string;
      places: {
        name?: string;
        category_id?: string | null;
        categories?: { name?: string } | null;
      } | null;
      categories: { name?: string } | null;
    };
    // Group key includes target_category_name so a sub-cat proposal that
    // implies a move ends up in a different group than the same slug under
    // the current parent (different decision for the user).
    const key = `${r.type}::${r.proposed_value.toLowerCase()}::${r.parent_category_id ?? ""}::${r.target_category_name ?? ""}`;
    const placeCurrentCategoryName =
      (r.places?.categories?.name as string | undefined) ?? null;
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.ids.push(r.id);
      if (r.confidence > existing.confidence) existing.confidence = r.confidence;
    } else {
      grouped.set(key, {
        key,
        type: r.type,
        proposed_value: r.proposed_value,
        parent_category_id: r.parent_category_id,
        parent_category_name: r.categories?.name ?? null,
        target_category_name: r.target_category_name,
        sample_place_category_name: placeCurrentCategoryName,
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
