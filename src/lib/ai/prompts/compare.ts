import "server-only";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";

/**
 * v1.19.0 (S2 F-04) — prompt builder for POST /api/ai/compare.
 *
 * Input = the stored place_profiles (the cheap part: profiles are
 * pre-digested review corpora, ~500-1500 tokens each), NOT raw reviews.
 * Follows the parse-query/rank-results builder convention: returns
 * { systemPrompt, userPrompt }.
 */

export interface CompareCandidate {
  /** Index in the request array — the ONLY reference the LLM may use. */
  idx: number;
  name: string;
  city: string | null;
  category: string | null;
  rating: number | null;
  ratingCount: number | null;
  priceRange: string | null;
  profile: PlaceProfile | null;
}

/** Compact, token-disciplined serialization of one candidate. */
function serializeCandidate(c: CompareCandidate): string {
  const lines: string[] = [
    `[${c.idx}] ${c.name}` +
      (c.city ? ` — ${c.city}` : "") +
      (c.category ? ` · ${c.category}` : ""),
  ];
  const meta: string[] = [];
  if (c.rating != null) {
    meta.push(`rating ${c.rating}${c.ratingCount ? ` (${c.ratingCount})` : ""}`);
  }
  if (c.priceRange) meta.push(`price ${c.priceRange}`);
  if (meta.length) lines.push(`  ${meta.join(" · ")}`);

  const p = c.profile;
  if (!p) {
    lines.push("  (no AI profile — judge only from the metadata above)");
    return lines.join("\n");
  }
  if (p.tldr) lines.push(`  tldr: ${p.tldr}`);
  if (p.pros?.length) lines.push(`  pros: ${p.pros.join("; ")}`);
  if (p.cons?.length) lines.push(`  cons: ${p.cons.join("; ")}`);
  if (p.theme_insights?.length) {
    const t = p.theme_insights
      .map(
        (i) =>
          `${i.theme}:${i.sentiment}(${i.mention_count}x,sal ${i.salience})`
      )
      .join(", ");
    lines.push(`  themes: ${t}`);
  }
  const f = p.features;
  if (f) {
    const bits: string[] = [];
    if (f.cuisine_types?.length) bits.push(`cuisine: ${f.cuisine_types.join("/")}`);
    if (f.atmosphere?.length) bits.push(`atmosphere: ${f.atmosphere.join(", ")}`);
    if (f.occasions?.length) bits.push(`occasions: ${f.occasions.join(", ")}`);
    if (f.distinctive?.length) bits.push(`distinctive: ${f.distinctive.join("; ")}`);
    if (bits.length) lines.push(`  ${bits.join(" | ")}`);
  }
  return lines.join("\n");
}

export function buildComparePrompt(candidates: CompareCandidate[]): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `You compare a user's saved places using their pre-computed AI profiles. Output strictly valid JSON matching the provided schema.

RULES:
1. Reference places ONLY by their bracketed index [0..${candidates.length - 1}]. Never invent ids or names in index fields.
2. "overall": 2-3 nuanced sentences. There is rarely one absolute winner — say what each place is best at.
3. "theme_verdicts": only themes where the profiles give REAL evidence (theme_insights, pros/cons). Skip themes with no signal. At most one verdict per theme.
4. "pick_by_occasion": 2-4 concrete occasions the user would actually choose between (e.g. "special dinner", "casual weeknight", "group night out"), each mapped to the best-fitting place with a one-sentence why. Derive occasions from the profiles' occasions/atmosphere — don't invent scenarios the data doesn't support.
5. A place without a profile can still win on rating/price, but say the evidence is thin.
6. Be honest and specific; no marketing fluff. English output.`;

  const userPrompt = `PLACES TO COMPARE (${candidates.length}):

${candidates.map(serializeCandidate).join("\n\n")}`;

  return { systemPrompt, userPrompt };
}
