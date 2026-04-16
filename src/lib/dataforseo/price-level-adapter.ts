/**
 * Convert DataForSEO string price level to numeric (Google-compatible).
 *
 * DataForSEO: "inexpensive" | "moderate" | "expensive" | "very_expensive"
 * Google:     0 (free) | 1 | 2 | 3 | 4
 */

const PRICE_MAP: Record<string, number> = {
  inexpensive: 1,
  moderate: 2,
  expensive: 3,
  very_expensive: 4,
};

export function convertPriceLevel(level: string | null): number | null {
  if (!level) return null;
  return PRICE_MAP[level.toLowerCase()] ?? null;
}
