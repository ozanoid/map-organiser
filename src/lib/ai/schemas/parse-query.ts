import { z } from "zod";

/**
 * Output of POST /api/ai/parse-query (Phase 6.5 LLM-as-judge pivot).
 *
 * The schema now has TWO concerns:
 *
 *   1. `hard`: EXCLUSION filters mapped to PlaceFilters. Used ONLY when
 *      the user wants exclusion (categories, cities, visit_status, etc.).
 *      Sub-categories/tags/lists go here ONLY when EXPLICITLY referenced
 *      ("sushi restaurants", "my date-spot tag", "in my London trip list").
 *
 *   2. `semantic_intent` (single rich string): everything else the LLM
 *      gleans from the query — mood, occasion fit, dietary preferences,
 *      cuisine hints, dealbreakers, vibe. Rank-results consumes this as
 *      natural language, alongside each candidate's full place_profile.
 *
 * The `boosts` field (curated-taxonomy hint chips) was removed in the
 * v1.8.1 follow-up: it duplicated signal the rank-results LLM already
 * has access to (it sees the full place_profile) and produced redundant
 * suggestions when the hard filter already located the user spatially
 * (e.g., 'london' tag suggestion when hard.city='London' was set). UI
 * surface (hint chip block) and `applyHintAsFilter` were also removed.
 *
 * The vocabulary-mismatch and synonym-blindness bugs that plagued the
 * v1.7.x soft_features layer are GONE because string matching is gone;
 * the LLM does semantic matching with natural language on both sides.
 *
 * See docs/_plans/phase-6-llm-as-judge-pivot.md for full rationale.
 *
 * LLMs sometimes emit `""` for an unwanted optional UUID field instead of
 * omitting it. Strict UUID validation then fails the whole response. These
 * preprocess wrappers clean common bad shapes BEFORE validation.
 */
const llmOptionalUuid = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().uuid().optional()
);

const llmOptionalUuidArray = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? (v as unknown[]).filter(
          (x) => typeof x === "string" && (x as string).trim() !== ""
        )
      : v,
  z.array(z.string().uuid()).optional()
);

const llmOptionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional()
);

export const ParseQuerySchema = z.object({
  hard: z.object({
    city: llmOptionalString,
    country: llmOptionalString,
    category_ids: llmOptionalUuidArray,
    subcategory_ids: llmOptionalUuidArray,
    tag_ids: llmOptionalUuidArray,
    list_id: llmOptionalUuid,
    rating_min: z.number().min(1).max(5).optional(),
    google_rating_min: z.number().min(1).max(5).optional(),
    visit_status: z
      .enum(["want_to_go", "booked", "visited", "favorite"])
      .optional(),
    created_after: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        z.string().datetime().optional()
      ),
    search: llmOptionalString,
  }),

  // Phase 6.5 LLM-as-judge pivot: `soft_features` was removed. All soft
  // matching (atmosphere/occasions/dietary/seating/cuisine/music/crowd/
  // distinctive/price/theme_insights) now happens inside rank-results
  // where the LLM reads the full place_profile and judges holistically.
  //
  // Phase 6.5 follow-up (v1.8.1): `boosts` was removed. The hint chip
  // UI it drove duplicated signal the rank-results LLM already evaluates,
  // and the LLM frequently surfaced redundant suggestions (e.g., 'london'
  // tag boost when hard.city='London' was already set).

  semantic_intent: z.string(),

  requires_semantic_ranking: z.boolean(),

  /** Non-null when the LLM judges the query truly ambiguous. UI shows this
   *  as a follow-up question; user can refine and resubmit. */
  needs_clarification: z.string().nullable(),
});

export type ParseQueryOutput = z.infer<typeof ParseQuerySchema>;
