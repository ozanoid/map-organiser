import { z } from "zod";

/**
 * Suggestions schema — shared shape between lite_profile (parse-link inline)
 * and the chip UI in AddPlaceDialog.
 *
 * Both `suggested_tags` and `suggested_lists` are present on PlaceProfile
 * but this stand-alone schema is useful when consumers only need the
 * suggestions slice (e.g. import-batch quick-decisions in Phase 3+).
 */
export const SuggestionsSchema = z.object({
  suggested_tags: z.object({
    matched_existing: z.array(z.string().uuid()),
    new_proposals: z.array(z.string()).max(3),
  }),
  suggested_lists: z.array(z.string().uuid()),
  suggested_subcategory: z
    .object({
      slug: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
});

export type Suggestions = z.infer<typeof SuggestionsSchema>;
