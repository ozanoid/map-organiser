import { z } from "zod";

/**
 * Output of POST /api/ai/rank-results.
 *
 * Each candidate is scored 0..1 against the query's semantic_intent.
 * The LLM bases its judgment primarily on the candidate's
 * place_profile.searchable_summary text; for candidates with no
 * profile it falls back to the name and assigns a lower score.
 *
 * `why` is a short user-facing rationale (≤ 120 chars) shown under
 * the place name in the result list.
 */
export const RankResultsSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string().uuid(),
      score: z.number().min(0).max(1),
      why: z.string().max(120),
    })
  ),
});

export type RankResultsOutput = z.infer<typeof RankResultsSchema>;
