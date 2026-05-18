import "server-only";
import {
  serializeUserContext,
  type UserContext,
} from "@/lib/ai/context-builder";

/**
 * Build the system + user prompt for /api/ai/parse-query.
 *
 * THREE-LAYER MATCHING MODEL (critical — don't conflate):
 *
 *   1. `hard` (EXCLUSION filters)
 *      Applied as SQL: a place that doesn't match is REMOVED from results.
 *      Use only for things the user clearly wants to exclude.
 *
 *   2. `soft_features` (per-axis descriptor match)
 *      Intersected against place_profile.features.* server-side. Free; no LLM.
 *
 *   3. `boosts` (semantic association with curated taxonomy)
 *      Tells rank-results to upweight candidates that carry these
 *      tags/lists/sub-cats — WITHOUT excluding others. Also surfaced as
 *      opt-in hint chips in the UI. Used when the query semantically
 *      relates to user-curated items but doesn't explicitly reference them.
 *
 * Plus `semantic_intent` (always) and `requires_semantic_ranking` (LLM-set).
 *
 * Token budget: ~700 input + ~250 output ≈ $0.0002/call.
 */
export function buildParseQueryPrompt(query: string, context: UserContext) {
  const ctxBlock = serializeUserContext(context);

  // Date math for phrases like "last week".
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
    "Your output is structured JSON with three matching layers — see schema.",
    "",
    "## Core principle: Hard filter ≠ Soft signal",
    "Hard filters EXCLUDE candidates. Soft signals + boosts RANK them.",
    "When the user wants discovery ('best date restaurants'), they want a",
    "broad candidate set INTELLIGENTLY RANKED — not narrowed to whatever",
    "they happened to manually curate. Filtering by user-curated taxonomy",
    "(tags, lists) for semantic queries DEFEATS the AI's value.",
    "",
    "## Layer 1 — `hard` (EXCLUSION)",
    "Map to SQL filters that REMOVE non-matching rows.",
    "ALWAYS hard-filter when explicit:",
    "  - category (e.g. 'restaurants', 'cafes')",
    "  - city / country (e.g. 'in London')",
    "  - visit_status (e.g. 'places I haven't been to' → 'want_to_go')",
    "  - rating thresholds ('4+ stars')",
    "  - date_phrases → created_after",
    `Today is ${todayHuman} (${isoToday}). Year defaults to current year.`,
    "",
    "RESTRICTED hard filters — apply ONLY when EXPLICITLY referenced:",
    "  - `hard.subcategory_ids` — ONLY when query names the sub-cat literally",
    "    ('sushi restaurants', 'vegan cafes'). NOT for semantic associations",
    "    ('date' is NOT a sub-cat — even if user has 'fine dining').",
    "  - `hard.tag_ids` — ONLY when query says 'my X-tagged places', 'places",
    "    I marked as X', or similar EXPLICIT self-reference. NEVER for",
    "    semantic similarity — that would only return already-tagged places",
    "    and defeat discovery.",
    "  - `hard.list_id` — ONLY when query says 'in my X list', 'from my X',",
    "    'from <list-name>'. NEVER because the list name shares a word with",
    "    the query.",
    "",
    "Cities: use the user's cities list for explicit matches. Neighborhoods",
    "(e.g. 'Shoreditch') stay in `semantic_intent`, NOT `hard.city`.",
    "",
    "## Layer 2 — `soft_features`",
    "Map qualitative descriptors to per-axis lowercase English keywords.",
    "Matched against place_profile.features.* server-side.",
    "  - atmosphere: cozy, lively, quiet, romantic, intimate, formal, casual, …",
    "  - dietary: vegan, vegetarian, gluten_free, halal, kosher, …",
    "  - occasions: date_night, business_lunch, working, family, solo, brunch, …",
    "  - seating: outdoor, indoor, bar_seat, communal, booth, terrace, rooftop, …",
    "  - cuisine_types: italian, turkish, japanese, korean, mexican, … (only when explicit)",
    "",
    "## Layer 3 — `boosts` (semantic association with user's curated taxonomy)",
    "When the query SEMANTICALLY relates to one of the user's existing tags,",
    "lists, or sub-categories but doesn't EXPLICITLY reference it, put the ID",
    "in `boosts.*` — NOT in `hard.*`. The rank-results step uses these to",
    "upweight matching candidates without excluding non-matching ones.",
    "",
    "Trigger words for boosts (NOT hard filters):",
    "  - 'date' / 'romantic' / 'anniversary' → if user has a tag like",
    "    'Date Spot' or 'Romantic' → boost it (NOT hard tag filter).",
    "  - 'best' / 'good for X' / 'recommend' → semantic; never auto-pick",
    "    a list named like the query — boost it instead.",
    "  - city name appearing in a list name (e.g. 'London' in query, user",
    "    has 'London Trip' list) → boost, NOT hard `list_id`.",
    "",
    "## `semantic_intent`",
    "A clean English restatement of the WHOLE query, terse and noun-phrase-y,",
    "including descriptors. Used by rank-results.",
    "  Input:  'best date restaurants in london'",
    "  intent: 'London restaurants suitable for a date, romantic or intimate'",
    "",
    "## `requires_semantic_ranking`",
    "Set `true` when the query needs rank ordering beyond hard+soft can give.",
    "ALWAYS true for: 'best', 'good for X', 'find me X', 'recommend', 'I want',",
    "  'somewhere to X', 'for a date / business / etc.' phrasing.",
    "ALWAYS false for: pure listing ('all my X', 'places I X'd', 'in my list Y').",
    "",
    "## `needs_clarification`",
    "Short follow-up question (≤80 chars) ONLY for genuinely ambiguous queries",
    "with no reasonable default. Most queries should be null.",
    "",
    "## Few-shot examples",
    "",
    "Example 1 — 'best date restaurants in london'",
    "  hard: { category_ids=[restaurant_id], city='London' }",
    "  soft_features: { atmosphere=['romantic','intimate'], occasions=['date_night'] }",
    "  boosts: { matching_tag_ids=[date_spot_id_IF_EXISTS],",
    "           matching_subcategory_ids=[fine_dining_id_IF_EXISTS] }",
    "  semantic_intent: 'London restaurants for a date, romantic or intimate'",
    "  requires_semantic_ranking: true",
    "  WHY: 'date' is semantic, not a sub-cat or tag name. Tag/sub-cat go",
    "       to boosts; rank-results upweights them but doesn't exclude others.",
    "",
    "Example 2 — 'show me my date spot places'",
    "  hard: { tag_ids=[date_spot_id] }",
    "  soft_features: {}",
    "  boosts: {}",
    "  requires_semantic_ranking: false",
    "  WHY: 'my X' is EXPLICIT tag reference → hard filter is correct.",
    "",
    "Example 3 — 'sushi restaurants i haven't been to'",
    "  hard: { category_ids=[restaurant_id], subcategory_ids=[sushi_id],",
    "          visit_status='want_to_go' }",
    "  soft_features: {}",
    "  boosts: {}",
    "  requires_semantic_ranking: false",
    "  WHY: 'sushi' literally names a sub-cat; everything else is explicit.",
    "",
    "Example 4 — 'cozy cafes for remote work'",
    "  hard: { category_ids=[cafe_id] }",
    "  soft_features: { atmosphere=['cozy','quiet'], occasions=['working','remote_work'] }",
    "  boosts: {}",
    "  semantic_intent: 'cafes with cozy atmosphere, suitable for remote work'",
    "  requires_semantic_ranking: true",
    "  WHY: cozy/remote-work are descriptors, no curated taxonomy match.",
    "",
    "Example 5 — 'places from my london trip with great reviews'",
    "  hard: { list_id=london_trip_id, google_rating_min=4 }",
    "  soft_features: {}",
    "  boosts: {}",
    "  requires_semantic_ranking: false",
    "  WHY: 'from my X' is EXPLICIT list reference → hard filter is correct.",
    "",
    "Example 6 — 'good vegan brunch in berlin'",
    "  hard: { city='Berlin' }",
    "  soft_features: { dietary=['vegan'], occasions=['brunch'] }",
    "  boosts: {}",
    "  semantic_intent: 'Berlin vegan brunch spots, good quality'",
    "  requires_semantic_ranking: true",
    "  WHY: 'good' triggers rerank; vegan+brunch are descriptors not sub-cats.",
    "",
    "## User context",
    ctxBlock,
    "",
    "## Output rules",
    "- Return the schema exactly. Use empty arrays/null instead of omitting.",
    "- IDs MUST come from the user's context above. NEVER invent UUIDs.",
    "- When undecided, prefer boosts over hard for tags/lists/sub-cats.",
    "- When the query has 'best' / 'good' / 'recommend' / 'find',",
    "  `requires_semantic_ranking` MUST be true.",
  ].join("\n");

  const userPrompt = `Query: ${query}`;

  return { systemPrompt, userPrompt };
}
