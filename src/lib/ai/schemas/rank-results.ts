import { z } from "zod";

/**
 * Output of POST /api/ai/rank-results.
 *
 * Each candidate is scored 0..1 against the query's semantic_intent.
 * The LLM bases its judgment primarily on the candidate's
 * place_profile.searchable_summary text; for candidates with no
 * profile it falls back to the name and assigns a lower score.
 *
 * `why` is a short user-facing rationale shown under the place name
 * in the result list. Target ~150 chars; preprocess truncates anything
 * over 200 chars to 197 + "…" so a wordy LLM never breaks the schema.
 *
 * v1.8.3: LLM occasionally exceeds the char target by a few chars
 * (observed: 124 chars when target was 120, single entry broke entire
 * response → "AI ranking unavailable" amber). Defense in depth:
 *   1. Prompt asks for ≤200 chars (looser target)
 *   2. Preprocess truncates anything over 200 → never fails schema
 *   3. Schema accepts up to 240 chars as final safety net
 * Also clamps score to [0,1] in case LLM emits 1.05 etc.
 */

const llmClampedScore = z.preprocess(
  (v) => (typeof v === "number" ? Math.max(0, Math.min(1, v)) : v),
  z.number().min(0).max(1)
);

const llmTruncatedWhy = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    return v.length > 200 ? `${v.slice(0, 197)}…` : v;
  },
  z.string().max(240)
);

export const RankResultsSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string().uuid(),
      score: llmClampedScore,
      why: llmTruncatedWhy,
    })
  ),
});

export type RankResultsOutput = z.infer<typeof RankResultsSchema>;
