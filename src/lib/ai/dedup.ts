import { isFuzzyMatch, normalize } from "./normalize";

/**
 * Post-LLM deduplication for entity proposals.
 *
 * LLMs sometimes propose entities that are semantic duplicates of existing
 * ones ("japanese-food" when the user already has "japanese"). This module
 * catches those proposals server-side and reroutes them to the existing entity.
 *
 * See docs/_archive/feature-suggestions_v3.md AI-04 and the AI Phase 1 plan
 * for the policy rationale (3-band auto-apply + moderation queue).
 */

interface EntityRef {
  id: string;
  name: string;
}

export interface DedupResult {
  /** Existing entity IDs that LLM matched (preserved) + reroute targets. */
  keptExistingIds: string[];
  /** Genuinely new proposals that have no fuzzy match in existing list. */
  newProposals: string[];
  /** LLM proposals that were rerouted to an existing entity (for telemetry). */
  rerouted: Array<{ proposed: string; matchedTo: EntityRef }>;
}

/**
 * Dedup a list of LLM-proposed new entity names against the user's existing
 * entities of the same kind (tags, lists, subcategories).
 *
 * @param proposals      Names the LLM wants to create.
 * @param existing       The user's current entities of the same type.
 * @param matchedExisting Entity IDs the LLM already matched (kept as-is).
 * @returns DedupResult with cleaned lists.
 */
export function dedupProposals(
  proposals: string[],
  existing: EntityRef[],
  matchedExisting: string[] = []
): DedupResult {
  const keptExistingIds = new Set<string>(matchedExisting);
  const newProposals: string[] = [];
  const rerouted: DedupResult["rerouted"] = [];

  // Deduplicate proposals among themselves first (case-insensitive).
  const seen = new Set<string>();

  for (const raw of proposals) {
    if (!raw || typeof raw !== "string") continue;
    const proposal = raw.trim();
    if (proposal.length === 0) continue;

    const key = normalize(proposal);
    if (seen.has(key)) continue;
    seen.add(key);

    const match = existing.find((e) => isFuzzyMatch(e.name, proposal));
    if (match) {
      keptExistingIds.add(match.id);
      rerouted.push({ proposed: proposal, matchedTo: match });
    } else {
      newProposals.push(proposal);
    }
  }

  return {
    keptExistingIds: [...keptExistingIds],
    newProposals,
    rerouted,
  };
}
