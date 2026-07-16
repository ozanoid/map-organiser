/**
 * v1.22.0 (NF-08): per-person cost defaults derived from
 * google_data.price_level (1-4, DataForSEO/Google provenance, ~66%
 * coverage). Hardcoded tier table per the repo's caps-are-code-constants
 * convention; places without price_level get NO default (empty-safe UI).
 * Currency conversion is deferred (v2) — defaults are flat USD.
 */
const PRICE_LEVEL_COST_USD: Record<number, number> = {
  1: 10,
  2: 25,
  3: 50,
  4: 90,
};

export function defaultCostEstimate(
  googleData: Record<string, unknown> | null | undefined
): number | null {
  const level = (googleData as { price_level?: number } | null)?.price_level;
  if (!level || !(level in PRICE_LEVEL_COST_USD)) return null;
  return PRICE_LEVEL_COST_USD[level];
}
