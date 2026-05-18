import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { dedupProposals } from "@/lib/ai/dedup";
import { normalize } from "@/lib/ai/normalize";

/**
 * Auto-apply policy for AI place_profile suggestions (Phase 4 + 5.5).
 *
 * Decision matrix per signal type:
 *
 * | Signal                                | Action                                                           |
 * |---------------------------------------|------------------------------------------------------------------|
 * | tag matched_existing                  | silent apply (place_tags INSERT)                                 |
 * | tag new_proposals (fuzzy → existing)  | silent reroute                                                   |
 * | tag new_proposals (genuinely new)     | queue (type='tag')                                               |
 * | sub-cat: existing slug, current parent| silent apply (places.subcategory_id UPDATE)                      |
 * | sub-cat: existing slug, NEW parent    | queue (type='subcategory', includes implicit category move)      |
 * | sub-cat: new slug, current parent     | queue (type='subcategory')                                       |
 * | sub-cat: new slug, NEW parent         | queue (type='subcategory', includes implicit category move)      |
 * | NO sub-cat, primary mismatches current| queue (type='category_change', pure move)                        |
 *
 * "NEW parent" = LLM primary ≠ place's currently assigned category, with
 * primary_confidence ≥ 0.85. The accept handler atomically updates the place's
 * category_id AND assigns the sub-cat when the user accepts.
 *
 * Lists are deliberately NOT applied here — see file-level note below.
 *
 * Called from POST /api/places/[id]/enrich?step=profile after the LLM call
 * resolves. Safe to re-run; existing junction rows are skipped and queue
 * rows dedupe on the partial UNIQUE INDEX.
 *
 * Scope note: lists are surfaced as opt-in chips in the Add Place dialog
 * (Phase 3 lite_profile) and that's the only place a user list assignment
 * originates from AI. Once the dialog is closed, silently assigning the
 * place to a list contradicts the user's explicit choice (or non-choice)
 * and pollutes list-grouped views.
 */

interface ApplyContext {
  userId: string;
  placeId: string;
  /** User's existing tags — for fuzzy dedup against LLM new_proposals. */
  tags: Array<{ id: string; name: string }>;
  /** User's full subcategory list — apply layer scans by (parent_id, slug). */
  subcategories: Array<{ id: string; slug: string; parent_category_id: string }>;
  /** Category currently assigned to the place (from places.category_id). */
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  /** User's full category list — used to resolve LLM primary→ID. */
  categories: Array<{ id: string; name: string }>;
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
  categoryChangeQueued: string | null;
}> {
  let tagsApplied = 0;
  let tagsQueued = 0;
  let subcategoryApplied: string | null = null;
  let subcategoryQueued: string | null = null;
  let categoryChangeQueued: string | null = null;

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

  // ───── Category + sub-category: unified mismatch-aware logic ─────
  //
  // The LLM returns a (primary, sub_category) pair. The decision tree:
  //
  //   1. Resolve "LLM target parent": user's category whose name matches
  //      profile.category_signals.primary. If we can't resolve, fall back to
  //      the place's currently assigned category (treat as "agree").
  //
  //   2. Compare resolved parent vs place's current category_id:
  //      - MATCH → existing 3-band logic for sub-cat under that parent.
  //      - MISMATCH at primary_confidence ≥ 0.85 → either a category_change
  //        (no sub-cat) or a subcategory proposal that *includes* the move.
  //
  // A "category change" or "move-including sub-cat" proposal lands in the
  // moderation queue rather than silent-applying, because moving a place to a
  // different parent is too consequential to do behind the user's back. The
  // accept handler atomically updates places.category_id and subcategory_id
  // when the user clicks Accept.

  const cs = profile.category_signals;
  const llmTargetCategory = cs.primary
    ? ctx.categories.find(
        (c) => c.name.toLowerCase() === cs.primary.toLowerCase()
      )
    : undefined;
  const llmTargetCategoryId = llmTargetCategory?.id ?? null;
  // If LLM names a category the user doesn't own, treat the request as if
  // it agreed with the current one (no mismatch path). Surfacing a queue
  // entry pointing at a non-existent category would just confuse the UI.
  const categoryMismatch =
    llmTargetCategoryId !== null &&
    ctx.currentCategoryId !== null &&
    llmTargetCategoryId !== ctx.currentCategoryId &&
    cs.primary_confidence >= 0.85;

  // Resolve sub-cat existence against the LLM's target parent (which may or
  // may not be the current parent).
  const targetSlug = cs.sub_category ? normalize(cs.sub_category) : null;
  const existingSubUnderTarget =
    targetSlug && llmTargetCategoryId
      ? ctx.subcategories.find(
          (s) =>
            s.parent_category_id === llmTargetCategoryId &&
            normalize(s.slug) === targetSlug
        )
      : undefined;

  const hasConfidentSubCat =
    cs.sub_category && cs.sub_category_confidence >= 0.85;

  if (hasConfidentSubCat && !categoryMismatch && existingSubUnderTarget) {
    // ── Scenario A: same parent, existing slug → silent apply ─────────────
    await supabase
      .from("places")
      .update({ subcategory_id: existingSubUnderTarget.id })
      .eq("id", ctx.placeId);
    subcategoryApplied = existingSubUnderTarget.id;
  } else if (
    hasConfidentSubCat &&
    !categoryMismatch &&
    !existingSubUnderTarget &&
    cs.sub_category_confidence >= 0.9
  ) {
    // ── Scenario B: same parent, NEW slug → queue (sub-cat only) ──────────
    await supabase.from("ai_suggestions_queue").insert({
      user_id: ctx.userId,
      place_id: ctx.placeId,
      type: "subcategory",
      proposed_value: cs.sub_category,
      parent_category_id: llmTargetCategoryId ?? ctx.currentCategoryId,
      target_category_name: null,
      confidence: cs.sub_category_confidence,
      source_model: ctx.modelVersion,
    });
    subcategoryQueued = cs.sub_category;
  } else if (
    hasConfidentSubCat &&
    categoryMismatch &&
    cs.sub_category_confidence >= 0.9
  ) {
    // ── Scenario C: NEW parent + sub-cat (existing OR new) → queue ────────
    // The accept handler atomically (a) moves the place to llmTargetCategoryId
    // and (b) creates-or-reuses the sub-cat under it.
    // target_category_name surfaces the move in the UI ("moves from X to Y").
    await supabase.from("ai_suggestions_queue").insert({
      user_id: ctx.userId,
      place_id: ctx.placeId,
      type: "subcategory",
      proposed_value: cs.sub_category,
      parent_category_id: llmTargetCategoryId,
      target_category_name: cs.primary,
      confidence: cs.sub_category_confidence,
      source_model: ctx.modelVersion,
    });
    subcategoryQueued = cs.sub_category;
  } else if (categoryMismatch && !hasConfidentSubCat) {
    // ── Scenario D: NEW parent, no usable sub-cat → pure category_change ──
    // No sub-cat ride-along; user just gets the move proposal.
    await supabase.from("ai_suggestions_queue").insert({
      user_id: ctx.userId,
      place_id: ctx.placeId,
      type: "category_change",
      proposed_value: cs.primary,
      parent_category_id: null,
      target_category_name: cs.primary,
      confidence: cs.primary_confidence,
      source_model: ctx.modelVersion,
    });
    categoryChangeQueued = cs.primary;
  }
  // Else: ignore (low confidence or nothing to do).

  return {
    tagsApplied,
    tagsQueued,
    subcategoryApplied,
    subcategoryQueued,
    categoryChangeQueued,
  };
}
