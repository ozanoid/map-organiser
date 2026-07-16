import { z } from "zod";

/**
 * v1.22.0 (S4 AI-09) — AI trip-plan output schema.
 *
 * ⚠️ NOT sent to Gemini as responseSchema (hotfix 2, 16.07.2026):
 * constrained decoding on this nested shape degenerated into repetition
 * loops (3 verified runs, all wedged in the first free-text field —
 * 60k-token runaway). The model now emits plain JSON per the prompt's
 * template; this schema validates SERVER-SIDE after JSON.parse.
 *
 * Candidates are referenced by INDEX into the request's candidate array
 * (v1.8.5 lesson — LLMs echo indices reliably, hallucinate UUIDs). The
 * route sanitizes out-of-range/duplicate indices after parse: first
 * occurrence wins, a place can appear in ONE day only.
 *
 * Same resilience idioms as compare.ts: arrays CLAMP via preprocess
 * (salvage over 502 — a failed parse still burns the budget unit), and
 * idx uses parseInt+NaN-guard (Number("") === 0 pitfall).
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

export const TIME_SLOTS = ["morning", "afternoon", "evening", "night"] as const;

export const TripPlanSchema = z.object({
  days: z.preprocess(
    clampArray(14),
    z.array(
      z.object({
        /** 1-indexed, must match an existing trip_days.day_number. */
        day_number: idx,
        /** Short day theme, e.g. "Old town & museums". */
        theme: shortText(80),
        /** 3-5 flowing sentences walking the traveller through the day
         *  in visit order ("Start your morning at X…, then…"). */
        narrative: shortText(900),
        stops: z.preprocess(
          clampArray(12),
          z.array(
            z.object({
              idx,
              time_slot: z.enum(TIME_SLOTS),
              /** Optional one-line reason ("great for sunset"). */
              note: shortText(150).optional(),
            })
          )
        ),
      })
    )
  ),
  /** Optional trip-wide tips. Empty is salvageable. */
  tips: z.preprocess(clampArray(3), z.array(shortText(200))),
});

export type TripPlanOutput = z.infer<typeof TripPlanSchema>;
