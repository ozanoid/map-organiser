/**
 * Text folding for matching user-typed words against stored text:
 * lower-case with Turkish rules (so "I", "İ" and "ı" all become "i"),
 * strip diacritics and punctuation. "Kadıköy/İstanbul" → "kadikoy istanbul".
 *
 * Postgres ILIKE in this database only folds ASCII case, so "Istanbul"
 * never matched "İstanbul" there — match on folded text in JS instead.
 * Shared by the Instagram matcher and the assistant tools.
 */

const TR_MAP: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** Lower-case (Turkish rules), strip diacritics and punctuation → "a b c". */
export function fold(s: string | null | undefined): string {
  let t = (s ?? "").toLocaleLowerCase("tr");
  t = t.replace(/[ışğüöçâîû]/g, (c) => TR_MAP[c] ?? c);
  t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/&/g, " and ").replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return t;
}
