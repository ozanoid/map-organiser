/**
 * String normalization helpers used by dedup, fuzzy matching, and AI
 * suggestion injection.
 *
 * normalize():
 *   - lowercases
 *   - trims
 *   - collapses whitespace and hyphens
 *   - strips diacritics
 *
 * Two strings that normalize to the same value are considered duplicates
 * for the purposes of tag/category/list matching.
 */
export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-") // spaces and underscores → hyphens
    .replace(/-{2,}/g, "-") // collapse runs of hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

/**
 * Levenshtein edit distance. Used to catch fuzzy duplicates LLMs may produce
 * ("japanese-food" when user already has "japanese").
 *
 * Cap input length to avoid quadratic blow-up on accidental long strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const MAX_LEN = 64;
  if (a.length > MAX_LEN || b.length > MAX_LEN) {
    // Guard against pathological inputs. Treat as "not similar".
    return Math.max(a.length, b.length);
  }

  // Use two-row dynamic programming for O(min(a,b)) memory.
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insert
        prev[j] + 1, // delete
        prev[j - 1] + cost // substitute
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Returns true if `a` and `b` are "similar" by either Levenshtein <= threshold
 * OR substring inclusion. Used as the catch-all fuzzy-match predicate.
 *
 * Defaults: threshold 2 (so "japanese" ↔ "japaneses" matches but
 * "thai" ↔ "italian" doesn't).
 */
export function isFuzzyMatch(
  a: string,
  b: string,
  threshold = 2
): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return levenshtein(na, nb) <= threshold;
}
