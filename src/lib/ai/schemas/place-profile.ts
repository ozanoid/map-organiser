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
    /** Retired v1.25.0 — the prompt requires this to be empty and the apply
     *  layer routes any straggler to vocabulary_candidates. Uncapped here for
     *  the same reason as pros/cons/evidence_quotes below. */
    new_proposals: z.array(z.string()),
  }),

  /** UUIDs of user lists this place semantically fits. */
  suggested_lists: z.array(z.string().uuid()),

  /**
   * Concepts from the global controlled vocabulary whose `bucket` is `tag`.
   * These are scenes, rituals, settings, policies and the like — things no
   * `features` axis has a home for, which is why they used to end up as one-off
   * strings in `distinctive`.
   *
   * `evidence` is mandatory and must be a verbatim quote from the reviews. The
   * requirement is what holds precision: with it, a 100-place run produced zero
   * hallucinations and left 27% of places with no concept at all, which is the
   * correct answer for a place the reviews say nothing distinctive about.
   *
   * The count cap lives in the prompt and in `applyProfileSuggestions`, not
   * here. A schema that enforces policy turns a model returning a ninth item
   * into a total profile failure — measured at 1 place in 12. The schema
   * validates SHAPE; the apply layer truncates.
   */
  matched_concepts: z.array(
    z.object({
      concept: z.string(),
      evidence: z.string(),
    })
  ),

  /**
   * The JOB B channel: something salient the vocabulary cannot express.
   *
   * Never surfaced to the user and never applied — it is written to
   * `vocabulary_candidates` and is the only input the next refresh has for
   * growing the dictionary. Without it the vocabulary ossifies: a closed-set
   * extractor with no gap channel found exactly one new concept across 400
   * places, because it had been turned into a classifier.
   */
  concept_gaps: z.array(z.string()),

  // ===== full-only =====
  tldr: z.string().nullable(),
  /**
   * COUNT LIMITS ARE NOT IN THIS SCHEMA. They live in the prompt and are
   * enforced by truncation in generate-profile.ts.
   *
   * A cap here does not trim the extra item, it throws away the entire profile.
   * Measured: `evidence_quotes.max(2)` discarded a complete, well-formed profile
   * — 50 reviews, four themes, a 300-word summary, five matched concepts —
   * because the model returned a third quote per theme. The place only got a
   * profile at all because an unrelated trigger happened to fire a second call
   * 34 seconds later that stayed under the limit. There is no retry; a place
   * whose single attempt overshoots is left with nothing, silently.
   *
   * The schema validates SHAPE. Policy is the caller's job.
   */
  pros: z.array(z.string()).nullable(),
  cons: z.array(z.string()).nullable(),

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
        evidence_quotes: z.array(z.string()),
      })
    )
    .nullable(),

  /** 250-400 words optimized for keyword + semantic ranking (AI-01).
   *  Profiles generated before 15.07.2026 carry 150-250 words. */
  searchable_summary: z.string().nullable(),

  // ===== meta =====
  source_review_count: z.number().int().min(0),
  generated_at: z.string(),
  model_version: z.string(),
});

export type PlaceProfile = z.infer<typeof PlaceProfileSchema>;
