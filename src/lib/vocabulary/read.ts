import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The global controlled vocabulary.
 *
 * Unlike categories, sub-categories, tags and lists, this dictionary is NOT
 * per-user — one vocabulary serves every account. It is read-only to the app
 * (`vocabulary_concepts` has no authenticated-write policy) and is rewritten
 * only by the monthly refresh job running under the service role.
 *
 * Why it exists: `place_profile.features.*` values were generated one place at
 * a time with no global view, so they fragmented — 400 places produced 368
 * distinct `occasions` values, with "date night" and "date-night" as separate
 * entries, and five spellings of "vegetarian options". A per-place LLM cannot
 * know what it called the same thing last time. Handing it a fixed vocabulary
 * turns an open-ended generation problem into closed-set classification, which
 * is both far more reliable and, unlike free text, filterable.
 *
 * Two destinations, decided per concept by `bucket`:
 *   features.<axis>  the LLM writes the canonical value into the existing
 *                    place_profile.features field — schema unchanged, so
 *                    rank-results / trip-plan / compare keep working untouched
 *   tag              the concept is applied to the place as a user tag
 */

export interface VocabularyConcept {
  id: string;
  canonical_name: string;
  definition: string;
  /** CUISINE | ATMOSPHERE | SCENE | RITUAL | POLICY | VALUE | … */
  family: string;
  /** `features.<axis>` for the seven descriptive families, else `tag`. */
  bucket: string;
  /** `GLOBAL`, or a country/region the concept only makes sense inside. */
  region: string;
  /** Share of the reference corpus that carried it at the last refresh. */
  coverage: number;
}

export interface Vocabulary {
  /** `features.<axis>` → the concepts the LLM may write into that axis. */
  byBucket: Map<string, VocabularyConcept[]>;
  /** Concepts destined for the tag system, definitions included. */
  tagConcepts: VocabularyConcept[];
  byId: Map<string, VocabularyConcept>;
  byName: Map<string, VocabularyConcept>;
  /** Raw phrase → concept id. The by-product of clustering that lets the
   *  rule-based lite path resolve a string with no LLM call. */
  aliases: Map<string, string>;
}

const EMPTY: Vocabulary = {
  byBucket: new Map(),
  tagConcepts: [],
  byId: new Map(),
  byName: new Map(),
  aliases: new Map(),
};

/**
 * Load the vocabulary.
 *
 * `deprecated_too_broad` concepts ARE loaded — describing a place and filtering
 * a library are different jobs, and the coverage ceiling belongs only to the
 * second. `cozy` sits on 60% of the corpus: useless as a filter, but the model
 * still has to call a cozy room cozy, and with the term withheld it invents its
 * own spelling and the canonicalisation is lost. Excluding them from the prompt
 * was measured twice — once as a dictionary-wide ceiling (-0.54 discriminating
 * matches/place) and again here (11% of axis values drifting off-vocabulary).
 *
 * They are kept out of `tagConcepts`, so they can be written into a features
 * axis but never become a tag or a filter pill.
 *
 * `deprecated_too_rare` is excluded outright — too thin to be worth prompting.
 *
 * Fails soft: a vocabulary outage must degrade the profile to its pre-dictionary
 * behaviour, not 500 the enrichment pipeline.
 */
export async function loadVocabulary(
  supabase: SupabaseClient
): Promise<Vocabulary> {
  const [conceptsRes, aliasesRes] = await Promise.all([
    supabase
      .from("vocabulary_concepts")
      .select("id, canonical_name, definition, family, bucket, region, coverage, status")
      .in("status", ["active", "deprecated_too_broad"])
      .order("coverage", { ascending: false }),
    supabase.from("vocabulary_aliases").select("alias, concept_id"),
  ]);

  const rows = (conceptsRes.data ?? []) as VocabularyConcept[];
  if (rows.length === 0) return EMPTY;

  const byBucket = new Map<string, VocabularyConcept[]>();
  const byId = new Map<string, VocabularyConcept>();
  const byName = new Map<string, VocabularyConcept>();
  const tagConcepts: VocabularyConcept[] = [];

  for (const c of rows) {
    byId.set(c.id, c);
    byName.set(c.canonical_name.toLowerCase(), c);
    if (c.bucket === "tag") {
      // Only assignable concepts become tags. A too-broad concept stays
      // describable but must never land on a place as a filterable label.
      if ((c as { status?: string }).status === "active") tagConcepts.push(c);
    } else {
      const list = byBucket.get(c.bucket);
      if (list) list.push(c);
      else byBucket.set(c.bucket, [c]);
    }
  }

  const aliases = new Map<string, string>();
  for (const a of (aliasesRes.data ?? []) as Array<{
    alias: string;
    concept_id: string;
  }>) {
    aliases.set(a.alias, a.concept_id);
  }

  return { byBucket, tagConcepts, byId, byName, aliases };
}

/** Same normalization the clustering used, so aliases resolve on first try. */
export function normalizeForAlias(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Resolve a raw phrase to a concept without an LLM call. Backs the lite path,
 * which must stay sub-second, and lets profiles written before the dictionary
 * existed keep resolving to canonical concepts at read time instead of needing
 * a 460-place regeneration.
 */
export function resolveAlias(
  vocab: Vocabulary,
  raw: string
): VocabularyConcept | null {
  const id = vocab.aliases.get(normalizeForAlias(raw));
  if (id) return vocab.byId.get(id) ?? null;
  return vocab.byName.get(raw.toLowerCase().trim()) ?? null;
}

/**
 * The per-axis vocabulary block for the profile prompt.
 *
 * Every concept is listed, including ones far too common to be useful as a
 * filter (`cozy` sits above half the corpus). That is deliberate: describing a
 * place accurately and filtering a library are different jobs, and the coverage
 * ceiling belongs to the second. Removing the broad concepts from the prompt was
 * measured and cost 0.54 discriminating matches per place.
 */
export function serializeBucketVocabulary(vocab: Vocabulary): string {
  if (vocab.byBucket.size === 0) return "";
  const lines: string[] = [];
  for (const [bucket, concepts] of [...vocab.byBucket.entries()].sort()) {
    const axis = bucket.replace("features.", "");
    // Bare names only. Annotating the region here (`modern-british [UK]`) was
    // measured leaking into the emitted value — the model copied the bracket
    // into the features array. Region scoping matters for scenes and rituals,
    // which live on the tag side where the definition carries the context.
    const names = concepts.map((c) => c.canonical_name).join(", ");
    lines.push(`  ${axis}: ${names}`);
  }
  return lines.join("\n");
}

/** The tag-destined concepts, with definitions — these need more context than a
 *  bare name because the model must judge them against review evidence. */
export function serializeTagVocabulary(vocab: Vocabulary): string {
  if (vocab.tagConcepts.length === 0) return "";
  return vocab.tagConcepts
    .slice()
    .sort((a, b) =>
      a.family === b.family
        ? a.canonical_name.localeCompare(b.canonical_name)
        : a.family.localeCompare(b.family)
    )
    .map(
      (c) =>
        `  ${c.canonical_name} [${c.family}${c.region === "GLOBAL" ? "" : `, ${c.region}`}] — ${c.definition}`
    )
    .join("\n");
}
