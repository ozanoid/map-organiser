import { z } from "zod";

/**
 * PlaceProfile — the pivot data layer for AI features.
 *
 * A profile is attached to a place at two completeness levels:
 *
 *   - lite: produced inline in /api/places/parse-link (rule-based, no LLM call).
 *           Only category_signals, features (DataForSEO-derived), and
 *           suggestions (existing-match only) are populated. Other fields null.
 *
 *   - full: produced by /api/places/[id]/enrich?step=profile after reviews
 *           are fetched. Single Gemini Flash call returns the full object.
 *
 * The same JSONB path (places.google_data.place_profile) holds either
 * variant; consumers branch on `completeness`.
 *
 * See docs/05-flows/ai-enrichment-flow.md (to be written in Phase 7).
 */
export const PlaceProfileSchema = z.object({
  completeness: z.enum(["lite", "full"]),

  category_signals: z.object({
    /** Must be one of the user's category names (NOT id — name is human-readable
     *  and stable across re-categorization). */
    primary: z.string(),
    primary_confidence: z.number().min(0).max(1),
    /** Subcategory slug. May reference an existing subcategory or a new
     *  proposal (gated by moderation queue in apply-suggestions). */
    sub_category: z.string().nullable(),
    sub_category_confidence: z.number().min(0).max(1),
    /** For hybrid venues, the secondary role description (e.g. "also a bar"). */
    secondary_role: z.string().nullable(),
  }),

  features: z.object({
    cuisine_types: z.array(z.string()),
    dietary: z.array(z.string()),
    atmosphere: z.array(z.string()),
    occasions: z.array(z.string()),
    seating: z.array(z.string()),
    music: z.array(z.string()),
    crowd: z.array(z.string()),
    price_range: z.enum(["$", "$$", "$$$", "$$$$"]).nullable(),
    distinctive: z.array(z.string()),
  }),

  suggested_tags: z.object({
    /** UUIDs of the user's existing tags that the AI matched. */
    matched_existing: z.array(z.string().uuid()),
    /** Brand-new tag names (lowercase-hyphenated). Max 3. Subject to
     *  post-LLM fuzzy dedup against existing tags. */
    new_proposals: z.array(z.string()).max(3),
  }),

  /** UUIDs of user lists this place semantically fits. */
  suggested_lists: z.array(z.string().uuid()),

  // ===== full-only =====
  tldr: z.string().nullable(),
  pros: z.array(z.string()).max(5).nullable(),
  cons: z.array(z.string()).max(5).nullable(),

  /**
   * Per-theme review consensus. Themes only appear if mention_count >= 3
   * (so museums don't get spurious "service" insights). Mention count is
   * inferred by the LLM from the review corpus.
   */
  theme_insights: z
    .array(
      z.object({
        theme: z.enum([
          "food",
          "drink",
          "service",
          "atmosphere",
          "value",
          "location",
          "cleanliness",
          "crowd",
        ]),
        sentiment: z.enum(["positive", "mixed", "negative"]),
        mention_count: z.number().int().min(0),
        salience: z.number().min(0).max(1),
        evidence_quotes: z.array(z.string()).max(2),
      })
    )
    .nullable(),

  /** 150-250 words optimized for keyword + semantic ranking (AI-01). */
  searchable_summary: z.string().nullable(),

  // ===== meta =====
  source_review_count: z.number().int().min(0),
  generated_at: z.string(),
  model_version: z.string(),
});

export type PlaceProfile = z.infer<typeof PlaceProfileSchema>;
