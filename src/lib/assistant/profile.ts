import { clip } from "@/lib/assistant/library";

/**
 * A saved place's review-derived profile (google_data.place_profile, written
 * by the enrichment pipeline) as the model reads it — one shape for every
 * tool that shows it, so get_places and rank_places describe a place the same
 * way.
 */

/** The parts of a stored profile the tools use. */
export interface StoredProfile {
  tldr?: string;
  pros?: string[];
  cons?: string[];
  features?: Record<string, unknown>;
  theme_insights?: Array<{
    theme?: string;
    sentiment?: string;
    salience?: number;
    mention_count?: number;
    evidence_quotes?: string[];
  }>;
}

/**
 * - `full` (get_places, 1–5 places): the one-line summary, pros, cons, the six
 *   most talked-about themes with a quote each, what it is good for.
 * - `shortlist` (rank_places, up to 30 candidates to judge at once): the same
 *   without the summary (the place's row already carries it) and the quotes,
 *   and four themes — about a third of the size. The finalists' full view is
 *   a get_places call away.
 */
export function profileForModel(profile: StoredProfile, view: "full" | "shortlist") {
  const full = view === "full";
  const themes = [...(profile.theme_insights ?? [])]
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, full ? 6 : 4)
    .map((t) => ({
      theme: t.theme,
      sentiment: t.sentiment,
      mentions: t.mention_count,
      ...(full ? { quote: clip(t.evidence_quotes?.[0], 220) } : {}),
    }));
  return {
    ...(full ? { summary: profile.tldr } : {}),
    pros: profile.pros?.slice(0, 5),
    cons: profile.cons?.slice(0, 5),
    themes,
    good_for: profile.features ?? {},
  };
}
