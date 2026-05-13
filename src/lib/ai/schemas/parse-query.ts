import { z } from "zod";

/**
 * Output of POST /api/ai/parse-query.
 *
 * The LLM parses a free-form natural-language query and returns:
 *   - `hard`: classical filters mapped to the existing PlaceFilters shape.
 *   - `soft_features`: descriptors of intent (e.g. "seaside", "romantic")
 *     to be matched against place_profile.features.* server-side.
 *   - `semantic_intent`: clean English restatement for LLM-as-judge ranking.
 *   - `requires_semantic_ranking`: should we invoke /api/ai/rank-results?
 *   - `needs_clarification`: an optional follow-up question for the user
 *     when intent is genuinely ambiguous and can't be defaulted.
 */
export const ParseQuerySchema = z.object({
  hard: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
    category_ids: z.array(z.string().uuid()).optional(),
    subcategory_ids: z.array(z.string().uuid()).optional(),
    tag_ids: z.array(z.string().uuid()).optional(),
    list_id: z.string().uuid().optional(),
    rating_min: z.number().min(1).max(5).optional(),
    google_rating_min: z.number().min(1).max(5).optional(),
    visit_status: z
      .enum(["want_to_go", "booked", "visited", "favorite"])
      .optional(),
    created_after: z.string().datetime().optional(),
    search: z.string().optional(),
  }),

  soft_features: z.object({
    cuisine_types: z.array(z.string()).optional(),
    atmosphere: z.array(z.string()).optional(),
    occasions: z.array(z.string()).optional(),
    seating: z.array(z.string()).optional(),
    dietary: z.array(z.string()).optional(),
  }),

  semantic_intent: z.string(),

  requires_semantic_ranking: z.boolean(),

  /** Non-null when the LLM judges the query truly ambiguous. UI shows this
   *  as a follow-up question; user can refine and resubmit. */
  needs_clarification: z.string().nullable(),
});

export type ParseQueryOutput = z.infer<typeof ParseQuerySchema>;
