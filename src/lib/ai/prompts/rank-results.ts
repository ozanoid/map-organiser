import "server-only";

/**
 * Rich payload sent per candidate in the LLM-as-judge architecture
 * (Phase 6.5). All fields are typed loose because they originate from
 * `places.google_data.place_profile.*` (JSONB) and the route normalizes
 * them server-side before passing to the prompt builder.
 */
export interface RankCandidate {
  id: string;
  name: string;
  /** ~250-400 words distilled from reviews by Phase 4 (150-250 on profiles
   *  generated before 15.07.2026). May be empty for pre-Phase-4 places. */
  searchable_summary: string;
  /** Per-axis arrays: atmosphere, occasions, dietary, seating,
   *  cuisine_types, music, crowd, distinctive, price_range. Whatever
   *  Phase 4 LLM produced — natural language, not a controlled vocab. */
  features: Record<string, unknown>;
  /** Per-theme sentiment + salience from Phase 4. */
  theme_insights: unknown[] | null;
  /** Short summary (1-2 sentence) of the place. */
  tldr: string | null;
  /** Phase 4 LLM-extracted positives. */
  pros: string[] | null;
  /** Phase 4 LLM-extracted negatives. */
  cons: string[] | null;
}

/**
 * Build the prompt for /api/ai/rank-results.
 *
 * Phase 6.5 LLM-as-judge architecture. Each candidate is sent with its
 * FULL place_profile (features.* + theme_insights + tldr + pros/cons +
 * searchable_summary). The LLM judges holistically against the rich
 * `semantic_intent` from parse-query.
 *
 * Token budgeting: ~700 tokens system + per-candidate ~1200 chars
 * (~300 tokens). For TOP_N=50: ~50 × 300 = 15K + 700 = ~16K input
 * tokens. Output: 50 × ~30 = 1.5K. Cost: ~$0.005/call.
 *
 * Threshold contract: the LLM has HIDE POWER. Candidates scored < 0.20
 * will be hidden from the user by the frontend. Score irrelevant matches
 * deliberately low to keep the answer engine clean.
 */
export function buildRankResultsPrompt(
  semanticIntent: string,
  candidates: RankCandidate[]
) {
  const systemPrompt = [
    "You score saved places against a user's semantic search intent.",
    "",
    "The downstream system is an ANSWER ENGINE: the user asks a question, the system",
    "returns the BEST matches and HIDES irrelevant ones. You are an active curator,",
    "not just a scorer. Use the threshold deliberately to filter out trash.",
    "",
    "Each candidate ships with a rich profile:",
    "  - `name`",
    "  - `searchable_summary` (~250-400 word distillation from reviews; primary signal)",
    "  - `features` (atmosphere, occasions, dietary, seating, cuisine_types, music,",
    "    crowd, distinctive, price_range — Phase 4 LLM-generated, natural language)",
    "  - `theme_insights` (per-theme sentiment: food/drink/service/atmosphere/value/",
    "    location/cleanliness/crowd, each with sentiment + salience + mention_count)",
    "  - `tldr` (1-2 sentence summary)",
    "  - `pros` / `cons` (Phase 4 LLM-extracted positives and negatives)",
    "",
    "Use ALL of these signals holistically. The `semantic_intent` from parse-query is",
    "a natural-language description of what the user wants — match it against the",
    "full profile, not just the summary. Synonyms count (romantic ≈ intimate ≈",
    "candlelit ≈ dimly-lit). Multi-language tolerant.",
    "",
    "## Scoring rubric — 6 tiers with DISPLAY VERDICT",
    "",
    "DISPLAY THRESHOLD = 0.20. Anything you score below 0.20 will be HIDDEN from",
    "the user. Use this power deliberately to filter out clearly irrelevant matches.",
    "",
    "  0.85 - 1.00  EXCELLENT match — top result, always show, confident",
    "  0.65 - 0.85  GOOD match — show with confidence",
    "  0.45 - 0.65  DECENT match — show, mid-tier ranking",
    "  0.25 - 0.45  MARGINAL match — show at bottom, low confidence",
    "  0.10 - 0.25  WEAK match — borderline, may be hidden",
    "  0.00 - 0.10  IRRELEVANT — HIDE, should not surface to the user",
    "",
    "Worked examples:",
    "  Query: 'best date restaurants in london'",
    "    - Lyle's (Michelin tasting menu, intimate, candlelit)              → 0.95",
    "    - Bambi (listening bar, intimate atmosphere, occasions=Date night) → 0.90",
    "    - AGORA souvla bar (Vibrant, Loud, Casual Dinner)                  → 0.20",
    "    - McDonald's                                                       → 0.05 (HIDE)",
    "",
    "  Query: 'all my vegan restaurants'",
    "    - Place with features.dietary=[Vegan, Vegan-friendly]              → 0.95",
    "    - Place with features.dietary=[Vegan-friendly, Vegetarian]         → 0.65",
    "    - Place with features.dietary=[] and reviews mention vegan menu    → 0.45",
    "    - BBQ steakhouse                                                   → 0.05 (HIDE)",
    "",
    "  Query: 'cozy cafes for remote work'",
    "    - Cafe with atmosphere=[Cozy, Quiet], occasions=[Working], pros=[good wifi] → 0.95",
    "    - Cafe with atmosphere=[Loud, Crowded], cons=[no seating]          → 0.10 (HIDE)",
    "",
    "When `searchable_summary` is empty (pre-Phase-4 place with no profile), score",
    "from `name` and features (if any) alone — cap your confidence at 0.40 because",
    "you lack the rich text signal.",
    "",
    "When `theme_insights` indicates negative sentiment on a theme the user cares",
    "about (e.g. user wants good service, theme_insights[service].sentiment=negative),",
    "lower the score accordingly.",
    "",
    "When `cons` lists a clear dealbreaker (e.g. user wants quiet, cons=['Very loud']),",
    "lower the score significantly.",
    "",
    "## `why` field",
    "",
    "Plain-English reason quoting CONCRETE signal from the profile. AIM for",
    "120-180 chars (≤ 200 is the HARD cap — strings over 200 will be auto-",
    "truncated server-side so write tight). Cite the field you used: feature",
    "value, theme insight, pros/cons quote, or a phrase from the summary.",
    "",
    "Good examples:",
    "  'Intimate listening bar, occasions include Date Night and Special occasion'",
    "  'Cozy with positive service sentiment and ample seating per reviews'",
    "  'Casual fast-food, no atmosphere match for a romantic date'",
    "",
    "Don't restate the place name. Don't use generic filler like 'good place'.",
    "Be specific. If you score < 0.20, the why should make clear WHY it's hidden.",
    "",
    "## Output",
    "",
    "For EACH candidate, return `{ idx, score, why }` where `idx` is the",
    "ZERO-BASED index of the candidate as listed below (idx=0 is the first",
    "candidate, idx=1 is the second, …). DO NOT invent or modify these",
    "indexes. The frontend sorts by score; you can output in any order.",
    "",
    "Return EVERY candidate. Do not skip any. Score irrelevant ones below",
    "0.20 — they will be hidden, not silently dropped here.",
  ].join("\n");

  const candidatesBlock = candidates
    .map((c, i) => {
      const featuresStr = JSON.stringify(c.features, null, 0);
      const themeStr = c.theme_insights
        ? JSON.stringify(c.theme_insights, null, 0)
        : "(none)";
      const tldrStr = c.tldr || "(none)";
      const prosStr = c.pros?.length ? c.pros.join("; ") : "(none)";
      const consStr = c.cons?.length ? c.cons.join("; ") : "(none)";
      // NOTE: candidate UUIDs are deliberately NOT included in the prompt.
      // The LLM references each candidate by its local index `idx`. Server-
      // side maps idx → id before returning to the client. This prevents
      // the LLM from typo'ing 36-char UUIDs (observed pre-v1.8.5: skipped
      // and hallucinated entries due to single-char UUID copy errors).
      return [
        `idx=${i}`,
        `name: ${c.name}`,
        `tldr: ${tldrStr}`,
        `summary: ${c.searchable_summary || "(none)"}`,
        `features: ${featuresStr}`,
        `theme_insights: ${themeStr}`,
        `pros: ${prosStr}`,
        `cons: ${consStr}`,
      ].join("\n");
    })
    .join("\n\n");

  const userPrompt = [
    `Semantic intent: ${semanticIntent}`,
    "",
    `Candidates (${candidates.length}, indexed 0..${candidates.length - 1}):`,
    candidatesBlock,
  ].join("\n");

  return { systemPrompt, userPrompt };
}
