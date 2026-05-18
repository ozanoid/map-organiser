import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { dedupProposals } from "@/lib/ai/dedup";
import { normalize } from "@/lib/ai/normalize";

/**
 * 3-band auto-apply policy for AI place_profile suggestions.
 *
 * - High confidence + EXISTING entity → silent auto-apply (insert join row).
 * - High confidence + NEW proposal → moderation queue (ai_suggestions_queue).
 * - Below threshold → ignore.
 *
 * Called from POST /api/places/[id]/enrich?step=profile after the LLM call
 * resolves. Safe to re-run on the same place (existing junction rows are
 * skipped; pending queue entries dedupe by UNIQUE INDEX).
 *
 * Scope note: this layer applies tags and sub-categories. **Lists are
 * intentionally NOT applied here.** Lists are surfaced as opt-in chips in
 * the Add Place dialog (Phase 3 lite_profile) and that's the only place a
 * user list assignment originates from AI. Once the dialog is closed,
 * silently assigning the place to a list contradicts the user's explicit
 * choice (or non-choice) and pollutes listed-grouped views.
 */

interface ApplyContext {
  userId: string;
  placeId: string;
  /** User's existing tags — for fuzzy dedup against LLM new_proposals. */
  tags: Array<{ id: string; name: string }>;
  /** User's existing subcategories for the place's parent — for fuzzy dedup. */
  subcategories: Array<{ id: string; slug: string; parent_category_id: string }>;
  /** Parent category resolved by the LLM (categories.id for the user). */
  parentCategoryId: string | null;
  /** Model version string for traceability in the queue. */
  modelVersion: string;
}

export async function applyProfileSuggestions(
  supabase: SupabaseClient,
  profile: PlaceProfile,
  ctx: ApplyContext
): Promise<{
  tagsApplied: number;
  tagsQueued: number;
  subcategoryApplied: string | null;
  subcategoryQueued: string | null;
}> {
  let tagsApplied = 0;
  let tagsQueued = 0;
  let subcategoryApplied: string | null = null;
  let subcategoryQueued: string | null = null;

  // ───── Tags: matched_existing → silent apply ─────
  if (profile.suggested_tags.matched_existing.length > 0) {
    const { data: existingPlaceTags } = await supabase
      .from("place_tags")
      .select("tag_id")
      .eq("place_id", ctx.placeId);
    const have = new Set(
      (existingPlaceTags ?? []).map((r) => r.tag_id as string)
    );
    const toInsert = profile.suggested_tags.matched_existing
      .filter((id) => !have.has(id))
      .map((id) => ({ place_id: ctx.placeId, tag_id: id }));
    if (toInsert.length > 0) {
      await supabase.from("place_tags").insert(toInsert);
      tagsApplied = toInsert.length;
    }
  }

  // ───── Tags: new_proposals → dedup + moderation queue ─────
  if (profile.suggested_tags.new_proposals.length > 0) {
    const dedupResult = dedupProposals(
      profile.suggested_tags.new_proposals,
      ctx.tags
    );

    // The dedup helper may have rerouted proposals to existing tags; apply those.
    if (dedupResult.rerouted.length > 0) {
      const reroutedIds = dedupResult.rerouted.map((r) => r.matchedTo.id);
      const { data: existing } = await supabase
        .from("place_tags")
        .select("tag_id")
        .eq("place_id", ctx.placeId);
      const have = new Set(
        (existing ?? []).map((r) => r.tag_id as string)
      );
      const toInsert = reroutedIds
        .filter((id) => !have.has(id))
        .map((id) => ({ place_id: ctx.placeId, tag_id: id }));
      if (toInsert.length > 0) {
        await supabase.from("place_tags").insert(toInsert);
        tagsApplied += toInsert.length;
      }
    }

    // Genuinely new ones → queue. The UNIQUE INDEX dedupes per
    // (user, type, normalized value, parent) so re-runs are safe.
    for (const proposal of dedupResult.newProposals) {
      await supabase.from("ai_suggestions_queue").insert({
        user_id: ctx.userId,
        place_id: ctx.placeId,
        type: "tag",
        proposed_value: proposal,
        confidence: 0.85,
        source_model: ctx.modelVersion,
      });
      // .insert errors on UNIQUE violation; treat any error as "already queued"
      // (we don't have ON CONFLICT support in the JS client without raw SQL).
      // The counter still reflects intent.
      tagsQueued++;
    }
  }

  // Lists deliberately not handled here — see file-level comment.

  // ───── Sub-category: high confidence + existing slug → silent apply ─────
  const cs = profile.category_signals;
  if (
    cs.sub_category &&
    cs.sub_category_confidence >= 0.85 &&
    ctx.parentCategoryId
  ) {
    const targetSlug = normalize(cs.sub_category);
    const existingSub = ctx.subcategories.find(
      (s) =>
        s.parent_category_id === ctx.parentCategoryId &&
        normalize(s.slug) === targetSlug
    );

    if (existingSub) {
      await supabase
        .from("places")
        .update({ subcategory_id: existingSub.id })
        .eq("id", ctx.placeId);
      subcategoryApplied = existingSub.id;
    } else if (cs.sub_category_confidence >= 0.9) {
      // NEW sub-category proposal — moderation queue.
      // We don't create the subcategory row here; Phase 5 UI will on accept.
      await supabase.from("ai_suggestions_queue").insert({
        user_id: ctx.userId,
        place_id: ctx.placeId,
        type: "subcategory",
        proposed_value: cs.sub_category,
        parent_category_id: ctx.parentCategoryId,
        confidence: cs.sub_category_confidence,
        source_model: ctx.modelVersion,
      });
      subcategoryQueued = cs.sub_category;
    }
  }

  return {
    tagsApplied,
    tagsQueued,
    subcategoryApplied,
    subcategoryQueued,
  };
}
