import "server-only";

export interface RankCandidate {
  id: string;
  name: string;
  /** From places.google_data.place_profile.searchable_summary. May be "" for
   *  pre-Phase-4 places that have no profile yet. */
  searchable_summary: string;
}

/**
 * Build the prompt for /api/ai/rank-results.
 *
 * Token budgeting: ~500 tokens system + per-candidate ~300 tokens summary +
 * ~30 tokens name. For TOP_N=50: ~50 × 330 = 16.5K input tokens. Output:
 * 50 × ~30 = 1.5K tokens. Comfortably under Flash's window; ~$0.002/call.
 *
 * The LLM's job: score each candidate 0..1 against the semantic intent,
 * give a short reason. The frontend uses the scores to reorder and
 * collapse low-confidence rows.
 */
export function buildRankResultsPrompt(
  semanticIntent: string,
  candidates: RankCandidate[]
) {
  const systemPrompt = [
    "You score saved places against a user's semantic search intent.",
    "Each place has a `searchable_summary` (150-250 word description distilled",
    "from reviews) and a `name`. Use the summary as the primary signal.",
    "",
    "## Scoring rubric",
    "Score is a float in [0, 1]:",
    "  0.90-1.00 : explicit match on multiple intent terms in the summary",
    "  0.70-0.89 : strong match on the main intent term(s)",
    "  0.40-0.69 : partial / implied match",
    "  0.10-0.39 : weak match or only related",
    "  0.00-0.09 : no signal or clearly mismatched",
    "",
    "When summary is empty, score from name alone — cap at 0.40 because",
    "there's insufficient information to be confident.",
    "",
    "## `why` field",
    "Short (≤ 120 chars) plain-English reason quoting concrete signal from",
    "the summary. Examples:",
    "  'Specialty coffee with strong wifi and freelancer crowd'",
    "  'Quiet workspace cafe, communal tables, all-day brunch'",
    "  'Takeaway-focused, no seating mentioned'",
    "Don't restate the place name. Don't use generic filler like 'good place'.",
    "",
    "## Output",
    "Return EVERY input candidate (same id), in any order. The frontend sorts.",
    "Do not skip candidates even when score is near 0.",
  ].join("\n");

  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `[${i + 1}] id=${c.id}\nname: ${c.name}\nsummary: ${
          c.searchable_summary || "(none)"
        }`
    )
    .join("\n\n");

  const userPrompt = [
    `Semantic intent: ${semanticIntent}`,
    "",
    `Candidates (${candidates.length}):`,
    candidatesBlock,
  ].join("\n");

  return { systemPrompt, userPrompt };
}
