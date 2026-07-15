/**
 * NF-03 (v1.18.0) — shared topic↔review matcher.
 *
 * Google's place_topics are SEMANTIC clusters counted over the place's
 * ENTIRE Google review pool; our stored corpus is a subset (relevance
 * backbone + newest pool, cap 200). A literal-phrase `includes` made the
 * chip counts and the filter results contradict each other on screen
 * ("scallop ceviche (5)" → filter finds 0, because no stored review has
 * the ADJACENT phrase).
 *
 * Token-AND matching: every word of the topic must appear somewhere in
 * the review text (not necessarily adjacent) — recall close to Google's
 * clustering while staying precise enough. Both the chips (local counts)
 * and the filter use THIS function, so displayed counts always equal
 * filter results by construction.
 */
export function reviewMatchesTopic(text: string, topic: string): boolean {
  const t = text.toLowerCase();
  return topic
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => t.includes(word));
}

/** Local match count for a topic over the stored review texts. */
export function countTopicMatches(
  texts: string[],
  topic: string
): number {
  let n = 0;
  for (const text of texts) {
    if (reviewMatchesTopic(text, topic)) n++;
  }
  return n;
}
