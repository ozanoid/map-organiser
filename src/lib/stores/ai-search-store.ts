"use client";

import { create } from "zustand";

/**
 * Per-session AI search state.
 *
 * Set by `useAiSearch` after a successful parse-query call; consumed by
 * `PlaceCard` (to show the `why`) and the list ordering logic (to sort by
 * score and collapse low-confidence rows under "Less relevant").
 *
 * Lives outside React Query because it's a transient UX session, not
 * server state — it should clear on `clearFilters`, on a new NL query,
 * or on navigation away.
 */
interface Ranking {
  score: number;
  why: string;
}

/** Boost IDs sent to rank-results for upweighting; also surfaced as UI hints. */
interface BoostIds {
  matching_tag_ids: string[];
  matching_list_ids: string[];
  matching_subcategory_ids: string[];
}

interface AiSearchState {
  /** English restatement; passed to rank-results. Null until parse-query lands. */
  semanticIntent: string | null;
  /** Whether the active query needs rerank (from parse-query). */
  needsRerank: boolean;
  /** Place ID → ranking map. Populated by rank-results response. */
  rankings: Map<string, Ranking> | null;
  /** Status of the rerank call (independent of parse-query). */
  rerankStatus: "idle" | "pending" | "ready" | "failed";
  /** LLM follow-up question for ambiguous queries; null when not needed. */
  clarification: string | null;
  /** The raw query the user typed, kept so chips can label it. */
  lastQuery: string | null;
  /** Semantic associations with user's curated taxonomy. NOT applied as
   *  hard filter — only used to (a) boost rank-results scores, (b) render
   *  opt-in hint chips for the user to convert into hard filters. */
  boosts: BoostIds;

  /** Apply parse-query output: clear stale rankings, set new intent + boosts. */
  applyParse: (input: {
    semantic_intent: string;
    requires_semantic_ranking: boolean;
    needs_clarification: string | null;
    query: string;
    boosts: BoostIds;
  }) => void;
  beginRerank: () => void;
  applyRankings: (rankings: { id: string; score: number; why: string }[]) => void;
  failRerank: () => void;
  reset: () => void;
}

const EMPTY_BOOSTS: BoostIds = {
  matching_tag_ids: [],
  matching_list_ids: [],
  matching_subcategory_ids: [],
};

export const useAiSearchStore = create<AiSearchState>((set) => ({
  semanticIntent: null,
  needsRerank: false,
  rankings: null,
  rerankStatus: "idle",
  clarification: null,
  lastQuery: null,
  boosts: EMPTY_BOOSTS,

  applyParse: ({
    semantic_intent,
    requires_semantic_ranking,
    needs_clarification,
    query,
    boosts,
  }) =>
    set({
      semanticIntent: semantic_intent,
      needsRerank: requires_semantic_ranking,
      rankings: null,
      rerankStatus: requires_semantic_ranking ? "pending" : "idle",
      clarification: needs_clarification,
      lastQuery: query,
      boosts,
    }),

  beginRerank: () => set({ rerankStatus: "pending" }),

  applyRankings: (rows) =>
    set({
      rankings: new Map(
        rows.map((r) => [r.id, { score: r.score, why: r.why }])
      ),
      rerankStatus: "ready",
    }),

  failRerank: () => set({ rerankStatus: "failed" }),

  reset: () =>
    set({
      semanticIntent: null,
      needsRerank: false,
      rankings: null,
      rerankStatus: "idle",
      clarification: null,
      lastQuery: null,
      boosts: EMPTY_BOOSTS,
    }),
}));

/**
 * Hide threshold (Phase 6.5 LLM-as-judge pivot).
 *
 * Candidates whose rank-results score is < HIDE_BELOW_SCORE are HIDDEN
 * from the user entirely — no card rendered, no marker on the map.
 *
 * The rank-results prompt is explicitly aware of this threshold and is
 * instructed to use its "hide power" deliberately: score irrelevant
 * matches below 0.20 to keep the answer engine clean. McDonald's for
 * "best date restaurants" → score 0.05 → HIDE.
 *
 * Replaces the v1.7.x fade-at-0.15 behavior. Hiding is more aligned with
 * the "answer engine, not firehose" UX direction the user asked for.
 *
 * If tuning empirically: lower for more permissive display (more cards),
 * raise for stricter filtering (fewer, more confident matches only).
 */
export const HIDE_BELOW_SCORE = 0.2;

/** @deprecated use HIDE_BELOW_SCORE. Kept as alias during slice rollout
 *  to avoid breaking PlaceCard / MapContent imports before Slice 4. */
export const LESS_RELEVANT_SCORE = HIDE_BELOW_SCORE;
