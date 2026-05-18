import "server-only";
import {
  serializeUserContext,
  type UserContext,
} from "@/lib/ai/context-builder";

/**
 * Build the system + user prompt for /api/ai/parse-query.
 *
 * The LLM's job: take a free-form English/Turkish query and decompose it into
 * three layers — hard SQL filters, soft JSONB features, and an unstructured
 * semantic intent string that the rerank step (rank-results) will evaluate.
 *
 * Token budget: ~500 input + ~150 output ≈ $0.0001/call.
 *
 * The schema is defined in src/lib/ai/schemas/parse-query.ts.
 *
 * Critical constraints encoded in the prompt:
 *   - LLM may ONLY return IDs that appear in the user's context. Server
 *     re-validates and strips unknown IDs as a second line of defense.
 *   - Output language is English (canonical) regardless of input language.
 *   - `requires_semantic_ranking` is set BY THE LLM when the query has
 *     fuzzy intent that the hard + soft layers cannot capture
 *     (e.g. "good for working alone", "low-key vibes"). We do NOT use
 *     result count as the trigger — that was a bug in the v1 sketch.
 *   - `needs_clarification` is set ONLY for truly ambiguous queries.
 */
export function buildParseQueryPrompt(query: string, context: UserContext) {
  const ctxBlock = serializeUserContext(context);

  // Today's date in user-friendly form for date-phrase resolution.
  // Year defaults to current year if absent in the query ("in May" → this year).
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const todayHuman = today.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const systemPrompt = [
    "You parse natural-language search queries about a personal collection of saved places.",
    "Your output is a structured JSON object with three matching layers — see schema.",
    "",
    "## Layer 1 — `hard` (classical filters)",
    "These map 1:1 to SQL filters. ONLY use IDs that appear in the user's context block below.",
    "If a category/sub-category/tag isn't in the context, do NOT make one up — leave the array empty.",
    "Dates: convert phrases like 'last week', 'in May', 'yesterday' to ISO date in `created_after`.",
    `Today is ${todayHuman} (${isoToday}). Year defaults to current year if missing.`,
    "Cities: use the user's cities list if the query mentions one. For neighbourhoods (e.g. 'Shoreditch'),",
    "leave `city` empty and rely on `semantic_intent` to carry the location hint into rerank.",
    "",
    "## Layer 2 — `soft_features` (matched against place_profile.features.*)",
    "Map qualitative descriptors to the per-feature axes. Use lowercase English keywords.",
    "  - atmosphere: cozy, lively, quiet, romantic, formal, casual, intimate, …",
    "  - dietary: vegan, vegetarian, gluten_free, halal, kosher, …",
    "  - occasions: date_night, business_lunch, working, family, solo, brunch, …",
    "  - seating: outdoor, indoor, bar_seat, communal, booth, terrace, rooftop, …",
    "  - cuisine_types: italian, turkish, japanese, korean, mexican, … (only when explicit)",
    "",
    "## Layer 3 — `semantic_intent` + `requires_semantic_ranking`",
    "`semantic_intent`: A clean English restatement of the WHOLE query, terse and noun-phrase-y,",
    "  including descriptors that didn't fit hard/soft. Example:",
    "    Input:  'cozy cafes in Shoreditch for remote work with good wifi'",
    "    intent: 'cozy cafes in Shoreditch suitable for remote work with reliable wifi'",
    "",
    "`requires_semantic_ranking`: Set `true` IFF the query contains fuzzy intent that hard+soft",
    "  alone cannot rank well. Examples:",
    "    'all my cafes'                       → false (structural only)",
    "    'cafes I haven't been to'            → false (visit_status covers it)",
    "    'cozy cafes for remote work'         → true (cozy + remote-work need profile text)",
    "    'date night spots with great views'  → true (subjective ranking needed)",
    "    'romantic dinner places'             → true",
    "",
    "## `needs_clarification`",
    "Set to a SHORT question (≤80 chars) ONLY when the query is genuinely ambiguous and",
    "no reasonable default exists. Examples:",
    "  'good places'                → 'What kind of place? Restaurant, cafe, bar?'",
    "  'food spots'                 → null (can map to Restaurant category)",
    "  'somewhere to go tonight'    → 'What kind of vibe — drinks, dinner, or live music?'",
    "Most queries should NOT need clarification. Default to null.",
    "",
    "## User context",
    ctxBlock,
    "",
    "Return the schema exactly. Use empty arrays/null instead of omitting fields.",
  ].join("\n");

  const userPrompt = `Query: ${query}`;

  return { systemPrompt, userPrompt };
}
