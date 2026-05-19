import { z } from "zod";

/**
 * TWO schemas live here:
 *
 *   1. `LlmRankSchema` — INTERNAL, what we ASK the LLM to produce.
 *      Uses local `idx` (0..N-1) instead of UUIDs, so the LLM never has
 *      to copy 36-char strings. See v1.8.4 + v1.8.5 for empirical evidence
 *      that UUID copying was the dominant source of "skipped" /
 *      "hallucinated" candidates.
 *
 *   2. `RankResultsSchema` — PUBLIC, what the /api/ai/rank-results route
 *      returns to the client. Still keyed by UUID `id`. The server maps
 *      LLM-side `idx` → public `id` before responding, so the client
 *      contract is unchanged.
 *
 * Each candidate is scored 0..1 against the query's semantic_intent.
 * The LLM bases its judgment primarily on the candidate's
 * place_profile.searchable_summary text; for candidates with no
 * profile it falls back to the name and assigns a lower score.
 *
 * `why` is a short user-facing rationale shown under the place name in
 * the result list. Target ~150 chars; preprocess truncates anything over
 * 200 chars to 197 + "…" so a wordy LLM never breaks the schema.
 *
 * v1.8.3 defense in depth (also applied here):
 *   1. Prompt asks for ≤200 chars (looser target)
 *   2. Preprocess truncates anything over 200 → never fails schema
 *   3. Schema accepts up to 240 chars as final safety net
 *   - Clamps score to [0,1] in case LLM emits 1.05 etc.
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

const llmCoercedIdx = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const parsed = parseInt(v, 10);
      return Number.isNaN(parsed) ? v : parsed;
    }
    return v;
  },
  z.number().int().min(0)
);

/**
 * INTERNAL: what we ask the LLM to produce. The route validates the LLM
 * response with this schema, then maps `idx` → `id` (via the candidates
 * array we sent) and returns a `RankResultsSchema`-shaped object to the
 * client.
 *
 * Out-of-range idx values (idx >= N) are caught server-side after this
 * validation passes — the schema can't know N. Duplicates are also
 * handled server-side.
 */
export const LlmRankSchema = z.object({
  ranked: z.array(
    z.object({
      idx: llmCoercedIdx,
      score: llmClampedScore,
      why: llmTruncatedWhy,
    })
  ),
});

export type LlmRankOutput = z.infer<typeof LlmRankSchema>;

/**
 * PUBLIC: shape returned by /api/ai/rank-results. The client's
 * `applyRankings` keys a Map by `id`, then place-card lookups it as
 * `aiRankings.get(place.id)`. Unchanged from earlier versions.
 */
export const RankResultsSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string().uuid(),
      score: z.number().min(0).max(1),
      why: z.string().max(240),
    })
  ),
});

export type RankResultsOutput = z.infer<typeof RankResultsSchema>;
