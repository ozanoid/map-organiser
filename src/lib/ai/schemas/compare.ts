import { z } from "zod";

/**
 * v1.19.0 (S2 F-04) — AI comparison output schema.
 *
 * Places are referenced by INDEX into the request's candidate array, not
 * by UUID — the v1.8.5 lesson from rank-results: LLMs echo indices
 * reliably but hallucinate/truncate UUIDs. The route sanitizes
 * out-of-range indices after parse.
 *
 * RESILIENCE (post-review hardening): the Google provider STRIPS
 * minItems/maxItems from the responseSchema it sends to Gemini, so array
 * bounds are only ever enforced at zod-parse time — a hard .max() turns
 * salvageable drift (a 5th occasion pick) into a 502 that still burns a
 * budget unit. Arrays therefore CLAMP via preprocess (slice, coerce
 * non-arrays to []), and idx uses the parseInt+NaN-guard idiom from
 * rank-results' llmCoercedIdx (Number("") === 0 would silently crown
 * place #0).
 */

const idx = z.preprocess((v) => {
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? v : n; // non-numeric string → fails z.number()
  }
  return v;
}, z.number().int().min(0));

const shortText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.slice(0, max) : v),
    z.string()
  );

/** Clamp: non-array → [], over-long → slice. Salvage over 502. */
const clampArray = (max: number) => (v: unknown) =>
  Array.isArray(v) ? v.slice(0, max) : [];

export const CompareSchema = z.object({
  /** 2-3 sentence nuanced overall verdict — NOT a single winner. */
  overall: shortText(600),
  /** Per-theme winner. FULL profile-insight enum (all 8 themes) — the
   *  prompt feeds theme_insights that include cleanliness/crowd; a
   *  narrower output enum made honest verdicts unrepresentable. */
  theme_verdicts: z.preprocess(
    clampArray(8),
    z.array(
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
        winner_idx: idx,
        /** One short sentence; may name the runner-up. */
        note: shortText(200),
      })
    )
  ),
  /** The v4-spec "nuanced recommendation": occasion → pick. Empty is
   *  salvageable (UI renders nothing) — no .min() hard-fail. */
  pick_by_occasion: z.preprocess(
    clampArray(4),
    z.array(
      z.object({
        occasion: shortText(60),
        idx,
        why: shortText(200),
      })
    )
  ),
});

export type CompareOutput = z.infer<typeof CompareSchema>;
