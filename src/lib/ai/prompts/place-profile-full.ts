import "server-only";
import {
  serializeUserContext,
  type UserContext,
} from "@/lib/ai/context-builder";

interface PromptInputPlace {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  /** Current parent category name assigned at save time (via lite mapping).
   *  Surfacing this to the LLM lets it consciously re-evaluate the rule-based
   *  classification — if reviews show the place is e.g. an Entertainment venue
   *  even though Google's types routed it to Bar & Nightlife, the LLM can
   *  push back with a different `primary` value. The apply layer treats any
   *  mismatch as a category_change proposal. */
  current_category_name: string | null;
  google_data: Record<string, unknown>;
}

/** Max reviews fed to the LLM per profile generation. */
const PROMPT_REVIEW_MAX = 50;
/** How many of those come from the relevance backbone (array head). */
const PROMPT_BACKBONE_TAKE = 35;

interface PromptReview {
  rating?: number;
  text?: string;
  publish_time?: string;
}

/**
 * Blend the review corpus into the ≤50 reviews the LLM actually reads:
 * the head of the array (Google's relevance-ranked backbone from the
 * initial fetch — the quality floor) + the freshest reviews from the rest
 * of the corpus (the change signal). NEVER "newest 50" alone — recency ≠
 * signal quality, and a newest-only diet would make each regeneration
 * WORSE than the original relevance-based profile.
 */
function selectReviewsForPrompt(reviews: PromptReview[]): PromptReview[] {
  if (reviews.length <= PROMPT_REVIEW_MAX) return reviews;
  const backbone = reviews.slice(0, PROMPT_BACKBONE_TAKE);
  const fresh = [...reviews.slice(PROMPT_BACKBONE_TAKE)]
    .sort((a, b) => (b.publish_time ?? "").localeCompare(a.publish_time ?? ""))
    .slice(0, PROMPT_REVIEW_MAX - backbone.length);
  return [...backbone, ...fresh];
}

/**
 * Truncate a single review for prompt-size control. Keeps the rating + first
 * 1000 chars — long-form reviews carry the richest signal for the
 * searchable_summary and theme_insights; 400 was cutting them too early.
 */
function compactReview(r: { rating?: number; text?: string }, maxChars = 1000) {
  const stars = typeof r.rating === "number" ? `[${r.rating}★] ` : "";
  const text = (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  return `${stars}${text}`;
}

/**
 * Build the system + user prompt for the full place_profile generation.
 *
 * Token budgeting: 50 reviews × ≤1000 chars ≈ up to 50K input chars ≈ ~12.5K
 * input tokens worst case (most reviews are shorter). Plus user context
 * (~500 tokens) + system rules (~500 tokens). Output is ~1-2K tokens.
 * Comfortably under Gemini Flash's window.
 */
export function buildPlaceProfilePrompt(
  place: PromptInputPlace,
  context: UserContext,
  liteProfileForPrior?: unknown
) {
  const gd = place.google_data ?? {};
  const types: string[] = Array.isArray((gd as { types?: unknown[] }).types)
    ? ((gd as { types: string[] }).types as string[])
    : [];
  const attributes = ((gd as { attributes?: Record<string, boolean> })
    .attributes ?? {}) as Record<string, boolean>;
  const onAttrs = Object.entries(attributes)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const placeTopics =
    ((gd as { place_topics?: Record<string, number> }).place_topics ?? {}) as Record<
      string,
      number
    >;
  const ratingDistribution = (gd as { rating_distribution?: unknown })
    .rating_distribution;
  const priceLevel = (gd as { price_level?: unknown }).price_level;
  const rating = (gd as { rating?: number }).rating;
  const reviewCount = (gd as { user_ratings_total?: number }).user_ratings_total;
  const reviewsRaw =
    ((gd as { reviews?: PromptReview[] }).reviews ?? []) as PromptReview[];
  // NOT `.map(compactReview)` — map passes (element, INDEX, array), and the
  // index silently bound to compactReview's `maxChars` param, truncating
  // review i to i characters. Every profile generated between Phase 4
  // (19.05.2026) and this fix was built from near-empty review text.
  const reviewLines = selectReviewsForPrompt(reviewsRaw)
    .map((r) => compactReview(r))
    .filter((s) => s.length > 0);

  const subsByParent: Record<string, string[]> = {};
  for (const sub of context.subcategories) {
    if (!subsByParent[sub.parent_name]) subsByParent[sub.parent_name] = [];
    subsByParent[sub.parent_name].push(sub.slug);
  }
  const subcategoryListString = Object.entries(subsByParent)
    .map(([parent, slugs]) => `  - ${parent}: ${slugs.join(", ")}`)
    .join("\n");

  const systemPrompt = `You are a structured place profile extractor for a place-management app. Output strictly valid JSON matching the provided schema. All output strings must be in English regardless of review language — translate when needed.

USER CONTEXT (entities the user already owns — use IDs from these lists):
${serializeUserContext(context)}

USER'S SUBCATEGORIES BY PARENT (slugs to choose from — only propose a new sub-category if NONE fit):
${subcategoryListString || "(none yet)"}

CRITICAL RULES:

1. CATEGORIZATION
   - "primary" must be EXACTLY one of the user's category names listed above.
   - "sub_category" should be a slug from the parent's list. Set sub_category_confidence accordingly.
   - Only propose a NEW sub-category slug (lowercase-hyphenated) if confidence > 0.9 AND none of the existing slugs fit.
   - "secondary_role" is non-null only for genuine hybrids (a restaurant that's also a bar).

2. TAGS (tag references use UUIDs, new proposals are strings)
   - "matched_existing" must be UUIDs from the user's tag list (bracketed in context).
   - "new_proposals" are NEW tag concept strings (MAX 3). Use lowercase-hyphenated. DO NOT propose a variation of an existing tag — if user has "japanese", don't propose "japanese-food".
   - Skip noisy commodity tags (wifi, parking, reservations, indoor, outdoor, price-level) — they're filtered downstream anyway.

3. LISTS (UUIDs only — never invent)
   - "suggested_lists" are UUIDs from the user's list collection. Be conservative — only suggest when the place clearly fits the list's theme.

4. THEME_INSIGHTS
   - Only include a theme if mention_count >= 3 across the review corpus.
   - "salience" 0-1: how important is this theme for THIS specific place type (a museum's "food" theme has low salience; a restaurant's "food" is high).
   - At most 2 evidence_quotes per theme, each ≤ 200 chars.

5. PROS / CONS
   - 2-5 short items each (3-7 words). Derived from review consensus, not single mentions. Cons must be honest but not snarky.

6. FEATURES
   - cuisine_types, dietary, atmosphere, occasions, seating, music, crowd: be specific but conservative.
   - price_range: pick "$" / "$$" / "$$$" / "$$$$" or null.

7. SEARCHABLE_SUMMARY
   - 250-400 words in English. Optimized for keyword + semantic ranking. Include: cuisine, atmosphere, occasions, distinctive features, location context, and recurring specifics reviewers mention (signature dishes, standout details). Avoid generic filler.

8. OUTPUT
   - STRICT JSON ONLY. No prose, no markdown, no commentary. The runtime will reject any output that fails Zod validation.

9. SET completeness = "full" AND source_review_count = number of reviews actually used.
`;

  const userPrompt = `PLACE
Name: ${place.name}
Address: ${place.address ?? "(unknown)"}, ${place.city ?? "(unknown city)"}, ${place.country ?? "(unknown country)"}
Currently assigned to category: ${place.current_category_name ?? "(none)"}
(This was set by a rule-based mapping at save time. Override with a different "primary" if the review evidence clearly contradicts it — e.g. a comedy club mis-routed to "Bar & Nightlife" should come back as "Entertainment".)
Google types: ${types.join(", ") || "(none)"}
DataForSEO attributes (true only): ${onAttrs.join(", ") || "(none)"}
DataForSEO place_topics: ${JSON.stringify(placeTopics)}
Rating: ${rating ?? "?"} (${reviewCount ?? "?"} ratings total)
Rating distribution: ${ratingDistribution ? JSON.stringify(ratingDistribution) : "(unavailable)"}
Price level: ${priceLevel ?? "?"}

${liteProfileForPrior ? `LITE PROFILE (prior — use as evidence but feel free to refine):\n${JSON.stringify(liteProfileForPrior)}\n` : ""}REVIEWS (latest ${reviewLines.length}):
${reviewLines.join("\n---\n") || "(no reviews available)"}
`;

  return { systemPrompt, userPrompt, usedReviewCount: reviewLines.length };
}
