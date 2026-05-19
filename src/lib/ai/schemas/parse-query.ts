import { z } from "zod";

/**
 * LLMs sometimes emit `""` for an unwanted optional UUID field instead of
 * omitting it. Strict UUID validation then fails the whole response. These
 * preprocess wrappers clean common bad shapes BEFORE validation:
 *   - empty / whitespace-only strings → undefined
 *   - empty arrays of empties → undefined
 *
 * The JSON schema sent to Gemini stays strict (uuid), but the parser
 * tolerates the small drift we observe in practice.
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

/**
 * Output of POST /api/ai/parse-query.
 *
 * Three-layer matching model — IMPORTANT to keep these distinct:
 *
 *   1. `hard`: EXCLUSION filters mapped to PlaceFilters. Used ONLY when
 *      the user wants exclusion (categories, cities, visit_status, etc.).
 *      Sub-categories/tags/lists go here ONLY when EXPLICITLY referenced
 *      ("sushi restaurants", "my date-spot tag", "in my London trip list").
 *
 *   2. `soft_features`: per-axis descriptors matched server-side against
 *      `place_profile.features.*`. No LLM call, just JSONB intersect.
 *
 *   3. `boosts`: semantic associations from user's curated taxonomy.
 *      "Date" → matching_tag_ids=[date_spot_id]. These DON'T filter —
 *      they tell rank-results to upweight candidates that already
 *      carry the curated label. Boosts are also surfaced as opt-in hint
 *      chips in the UI ("You have places tagged Date Spot — show only?").
 *
 *      The reason this layer exists: filtering by a user-curated tag like
 *      "Date Spot" would self-defeat discovery — only the places the user
 *      ALREADY marked would show. Boosts preserve discovery while still
 *      rewarding the user's curation effort.
 *
 *   Plus:
 *   - `semantic_intent`: clean English restatement for LLM-as-judge.
 *   - `requires_semantic_ranking`: trigger for /api/ai/rank-results.
 *   - `needs_clarification`: follow-up question when intent is ambiguous.
 */
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

  soft_features: z.object({
    cuisine_types: z.array(z.string()).optional(),
    atmosphere: z.array(z.string()).optional(),
    occasions: z.array(z.string()).optional(),
    seating: z.array(z.string()).optional(),
    dietary: z.array(z.string()).optional(),
  }),

  /**
   * Semantic associations from the user's curated taxonomy. Non-filtering
   * — boosts rank-results scores AND surface as opt-in UI hint chips.
   * IDs MUST come from the user's context (validated server-side).
   */
  boosts: z.object({
    matching_tag_ids: llmOptionalUuidArray,
    matching_list_ids: llmOptionalUuidArray,
    matching_subcategory_ids: llmOptionalUuidArray,
  }),

  semantic_intent: z.string(),

  requires_semantic_ranking: z.boolean(),

  /** Non-null when the LLM judges the query truly ambiguous. UI shows this
   *  as a follow-up question; user can refine and resubmit. */
  needs_clarification: z.string().nullable(),
});

export type ParseQueryOutput = z.infer<typeof ParseQuerySchema>;
