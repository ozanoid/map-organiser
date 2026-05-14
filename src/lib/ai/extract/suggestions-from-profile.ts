/**
 * Match a place's features against the user's existing tags and lists to
 * produce suggestion lists. LLM-less; uses fuzzy matching via `isFuzzyMatch`.
 *
 * Lite path only emits `matched_existing` for tags — new tag proposals
 * require LLM nuance (Phase 4 full profile). Lists never get "new
 * proposals" since users create lists themselves.
 */

import { isFuzzyMatch, normalize } from "@/lib/ai/normalize";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";

type Features = PlaceProfile["features"];

interface TagRef {
  id: string;
  name: string;
}

interface ListRef {
  id: string;
  name: string;
}

/**
 * Feature values that are technically present on the place but are too
 * common (or anti-features) to surface as suggestion chips.
 *
 * Rationale: `extractDistinctive` flags every wifi-equipped venue with
 * "wifi", which is true but not interesting — almost every modern
 * restaurant/cafe has wifi. Showing "wifi" as a chip on every paste-link
 * teaches users to dismiss suggestions, not act on them.
 *
 * IMPORTANT: features.* still contains these — the suppression is purely
 * for the suggestion-chip UI. Phase 4's LLM full profile still sees the
 * full feature set in context (and can override with salience), and
 * future filter dimensions can still use them.
 *
 * Suppress list is intentionally conservative. Anything truly distinctive
 * (vegan, live-music, dog-friendly, accessible, lgbtq-friendly,
 * cuisine_types, private-room) stays.
 */
const SUPPRESSED_FROM_SUGGESTIONS = new Set<string>([
  // Distinctive flags that are too common to be useful as tags
  "wifi",
  "parking",
  "reservations",
  // Heuristic flags that don't translate to a clean tag
  "photogenic",
  "unclaimed",
  // Seating: indoor/outdoor are too common; rooftop / private-room / bar-seating stay
  "indoor",
  "outdoor",
  // Price range as a tag is rarely what users want ("$$" tag = noise)
  "$",
  "$$",
  "$$$",
  "$$$$",
]);

/**
 * Tag candidates derived from feature values. Each candidate is matched
 * against existing user tags via `isFuzzyMatch` and only emitted when a
 * match is found (lite path = `matched_existing` only).
 *
 * Values in SUPPRESSED_FROM_SUGGESTIONS are skipped here — they remain in
 * `features.*` for downstream consumers (Phase 4 LLM, future filters)
 * but never appear as a suggestion chip in the Add dialog.
 */
function collectTagCandidates(features: Features): string[] {
  const candidates = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    if (SUPPRESSED_FROM_SUGGESTIONS.has(value)) return;
    candidates.add(value);
  };

  features.cuisine_types.forEach(push);
  features.dietary.forEach(push);
  features.distinctive.forEach(push);
  features.seating.forEach(push);
  features.atmosphere.forEach(push);
  features.occasions.forEach(push);
  push(features.price_range ?? undefined);
  return [...candidates];
}

export function matchTagsFromFeatures(
  features: Features,
  userTags: TagRef[]
): PlaceProfile["suggested_tags"] {
  const matched = new Set<string>();
  for (const candidate of collectTagCandidates(features)) {
    const hit = userTags.find((t) => isFuzzyMatch(t.name, candidate));
    if (hit) matched.add(hit.id);
  }
  return {
    matched_existing: [...matched],
    new_proposals: [], // lite path emits no new tags
  };
}

/**
 * Match user lists against the place's signal set:
 *   - List name contains the place's city → match
 *   - List name fuzzy-matches a cuisine_type or distinctive feature → match
 *   - List name fuzzy-matches the primary or secondary parent category → match
 *
 * Conservative by design — false positives feel like "AI nagging".
 */
export function matchListsFromProfile(
  features: Features,
  context: {
    city?: string | null;
    country?: string | null;
    primaryCategory: string;
    secondaryRole: string | null;
  },
  userLists: ListRef[]
): string[] {
  const matched = new Set<string>();
  const cityNorm = context.city ? normalize(context.city) : null;
  const countryNorm = context.country ? normalize(context.country) : null;

  for (const list of userLists) {
    const listNorm = normalize(list.name);
    if (listNorm.length < 3) continue; // too short to safely match

    // City inclusion (e.g. "Istanbul Cafes" + place.city="Istanbul")
    if (cityNorm && listNorm.includes(cityNorm)) {
      matched.add(list.id);
      continue;
    }
    // Country inclusion (e.g. "Japan Trip" + place.country="Japan")
    if (countryNorm && listNorm.includes(countryNorm)) {
      matched.add(list.id);
      continue;
    }
    // Primary or secondary category mention
    if (
      isFuzzyMatch(list.name, context.primaryCategory) ||
      (context.secondaryRole && isFuzzyMatch(list.name, context.secondaryRole))
    ) {
      matched.add(list.id);
      continue;
    }
    // Cuisine or distinctive feature in list name
    const matchedFeature = [...features.cuisine_types, ...features.distinctive].some(
      (f) => isFuzzyMatch(list.name, f)
    );
    if (matchedFeature) {
      matched.add(list.id);
    }
  }

  return [...matched];
}
