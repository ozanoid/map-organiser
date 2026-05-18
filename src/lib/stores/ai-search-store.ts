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

  /** Apply parse-query output: clear stale rankings, set new intent. */
  applyParse: (input: {
    semantic_intent: string;
    requires_semantic_ranking: boolean;
    needs_clarification: string | null;
    query: string;
  }) => void;
  beginRerank: () => void;
  applyRankings: (rankings: { id: string; score: number; why: string }[]) => void;
  failRerank: () => void;
  reset: () => void;
}

export const useAiSearchStore = create<AiSearchState>((set) => ({
  semanticIntent: null,
  needsRerank: false,
  rankings: null,
  rerankStatus: "idle",
  clarification: null,
  lastQuery: null,

  applyParse: ({
    semantic_intent,
    requires_semantic_ranking,
    needs_clarification,
    query,
  }) =>
    set({
      semanticIntent: semantic_intent,
      needsRerank: requires_semantic_ranking,
      rankings: null,
      rerankStatus: requires_semantic_ranking ? "pending" : "idle",
      clarification: needs_clarification,
      lastQuery: query,
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
    }),
}));

/** Default threshold below which a card collapses under "Less relevant". */
export const LESS_RELEVANT_SCORE = 0.3;
