"use client";

import { create } from "zustand";
import type { PlaceFilters } from "@/lib/types";

/**
 * Per-session AI search state.
 *
 * Set by `useAiSearch` after a successful parse-query call; consumed by
 * `PlaceCard` (why line), MapContent (marker filter + sidebar sort),
 * /places page (card grid sort + hide), AISearchInput (banner).
 *
 * Lives outside React Query because it's a transient UX session, not
 * server state — it should clear on `clearFilters`, on a new NL query,
 * or on navigation away.
 *
 * Boost / hint-chip state was removed in v1.8.1: the LLM rank-results
 * step already sees curated taxonomy context and judges holistically.
 */
interface Ranking {
  score: number;
  why: string;
}

/** Adaptive broaden state — Phase 6.5 Slice 5.
 *
 * When the initial hard filter returns < BROADEN_THRESHOLD candidates AND
 * the hard contains restricted explicit references (subcategory_ids,
 * tag_ids, list_id), the orchestrator drops those restricted filters and
 * re-fetches the broader candidate set. The banner lets the user toggle
 * between the two views.
 */
interface BroadenState {
  /** Hard filter from parse-query AS-IS (narrow set). */
  narrowFilters: Partial<PlaceFilters>;
  /** Hard filter with restricted axes dropped (broader set). */
  broaderFilters: Partial<PlaceFilters>;
  /** Number of candidates the narrow filter produced. */
  narrowCount: number;
  /** Number of candidates the broader filter produced. */
  broaderCount: number;
  /** Which axes were dropped to go from narrow → broader. Human-readable
   *  labels for the banner (e.g. ["fine-dining"]). */
  droppedLabels: string[];
  /** Which view is currently applied to the filter URL state. */
  activeMode: "narrow" | "broader";
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
  /** Adaptive broaden state; null when no broaden was triggered. */
  broaden: BroadenState | null;
  /** "checking" → narrow set fetched but not yet evaluated for broaden;
   *  "ready" → either broaden was applied OR not needed, downstream can proceed. */
  broadenStatus: "idle" | "checking" | "ready";

  /** Apply parse-query output: clear stale rankings, set new intent. */
  applyParse: (input: {
    semantic_intent: string;
    requires_semantic_ranking: boolean;
    needs_clarification: string | null;
    query: string;
  }) => void;
  /** Mark "narrow fetched, deciding whether to broaden". */
  beginBroadenCheck: () => void;
  /** Set the full broaden state after the broader fetch completes. */
  applyBroaden: (state: BroadenState) => void;
  /** Mark "broaden check finished, no broaden needed (or applied)" so the
   *  rerank step can proceed. */
  resolveBroadenCheck: () => void;
  /** User clicked a banner toggle. Switch active mode. */
  setBroadenActiveMode: (mode: "narrow" | "broader") => void;
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
  broaden: null,
  broadenStatus: "idle",

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
      // Reset broaden state on every new query.
      broaden: null,
      broadenStatus: requires_semantic_ranking ? "checking" : "idle",
    }),

  beginBroadenCheck: () => set({ broadenStatus: "checking" }),

  applyBroaden: (state) =>
    set({
      broaden: state,
      broadenStatus: "ready",
    }),

  resolveBroadenCheck: () => set({ broadenStatus: "ready" }),

  setBroadenActiveMode: (mode) =>
    set((s) =>
      s.broaden ? { broaden: { ...s.broaden, activeMode: mode } } : {}
    ),

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
      broaden: null,
      broadenStatus: "idle",
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
 * matches below 0.20 to keep the answer engine clean.
 */
export const HIDE_BELOW_SCORE = 0.2;

/**
 * Adaptive broaden trigger threshold (Phase 6.5 Slice 5).
 *
 * If the initial hard filter (with explicit subcategory_ids / tag_ids /
 * list_id) returns fewer than this many candidates, the system also
 * computes a broader filter set (dropping those restricted axes) and
 * lets the user toggle between narrow and broader via a banner.
 */
export const BROADEN_THRESHOLD = 10;
