"use client";

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";
import { useFilters } from "@/lib/hooks/use-filters";
import { usePlaces } from "@/lib/hooks/use-places";
import type { Place, PlaceFilters } from "@/lib/types";
import type { ParseQueryOutput } from "@/lib/ai/schemas/parse-query";
import type { RankResultsOutput } from "@/lib/ai/schemas/rank-results";

/**
 * Submit a natural-language query.
 *
 * Flow (Phase 6.5 LLM-as-judge):
 *   1. POST /api/ai/parse-query with the raw query.
 *   2. Apply the returned `hard` to the filter URL state. Soft matching
 *      (atmosphere/occasions/etc.) no longer lives in URL — it's carried
 *      by `semantic_intent` and consumed by rank-results.
 *   3. Save semantic_intent + requires_semantic_ranking + boosts into
 *      the AI search store.
 *
 * The rerank step is triggered by `useAiRerankOrchestrator()` once the
 * places list refetches with the new filters — see below.
 */
export function useAiSearch() {
  const { setFilters } = useFilters();
  const applyParse = useAiSearchStore((s) => s.applyParse);
  const reset = useAiSearchStore((s) => s.reset);

  return useMutation({
    mutationFn: async (query: string): Promise<ParseQueryOutput> => {
      const res = await fetch("/api/ai/parse-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to parse query");
      }
      return (await res.json()) as ParseQueryOutput;
    },
    onSuccess: (data, query) => {
      // Build the next PlaceFilters from parse output — hard only.
      // AI search OVERRIDES the user's sort preference to
      // google_rating_desc (quality-first). When the user clears the
      // AI search (X button → handleClear), AISearchInput resets sort
      // to undefined so the FilterPanel dropdown returns to user control.
      const nextFilters: Partial<PlaceFilters> = {
        category_ids: data.hard.category_ids,
        subcategory_ids: data.hard.subcategory_ids,
        tag_ids: data.hard.tag_ids,
        list_id: data.hard.list_id,
        city: data.hard.city,
        country: data.hard.country,
        visit_status: data.hard.visit_status,
        rating_min: data.hard.rating_min,
        google_rating_min: data.hard.google_rating_min,
        search: data.hard.search,
        sort: "google_rating_desc",
      };

      setFilters(nextFilters);
      applyParse({
        semantic_intent: data.semantic_intent,
        requires_semantic_ranking: data.requires_semantic_ranking,
        needs_clarification: data.needs_clarification,
        query,
        boosts: {
          matching_tag_ids: data.boosts.matching_tag_ids ?? [],
          matching_list_ids: data.boosts.matching_list_ids ?? [],
          matching_subcategory_ids: data.boosts.matching_subcategory_ids ?? [],
        },
      });
    },
    onError: () => {
      // Don't clobber existing filters on failure; the store reset signals
      // "no active AI search" so UI hides chips.
      reset();
    },
  });
}

/**
 * Orchestrator: when `needsRerank` is true and the places list has settled
 * with the new filters, fire the rerank call. Wires the response into the
 * AI search store.
 *
 * Mount this once (ideally near where `usePlaces` lives, in MapContent or
 * an ancestor). It's a side-effect-only hook — no UI returned.
 */
export function useAiRerankOrchestrator(filters: PlaceFilters) {
  const semanticIntent = useAiSearchStore((s) => s.semanticIntent);
  const needsRerank = useAiSearchStore((s) => s.needsRerank);
  const rerankStatus = useAiSearchStore((s) => s.rerankStatus);
  const applyRankings = useAiSearchStore((s) => s.applyRankings);
  const failRerank = useAiSearchStore((s) => s.failRerank);
  // boosts: read by AISearchInput for hint chips (Slice 4 UI). Not used
  // here in the orchestrator — Phase 6.5 dropped the boost score bump.

  const { data: places, isFetching } = usePlaces(filters);

  useEffect(() => {
    // Trigger conditions:
    //  - parse-query set needsRerank
    //  - we have a places list (post-filter)
    //  - we're not already done or already fetching from places query
    //  - rerankStatus is "pending" (initial state set by applyParse)
    if (!needsRerank) return;
    if (!semanticIntent) return;
    if (rerankStatus !== "pending") return;
    if (isFetching) return;
    if (!places) return;

    if (places.length === 0) {
      // Nothing to rerank; bail to "ready" so UI doesn't spin forever.
      applyRankings([]);
      return;
    }

    void runRerank({
      semanticIntent,
      places,
      onSuccess: applyRankings,
      onError: failRerank,
    });
    // We intentionally depend on `places.length` rather than `places` to
    // avoid re-firing on every refetch with identical IDs. A new NL query
    // resets rerankStatus to "pending" so we'll fire again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRerank, semanticIntent, rerankStatus, isFetching, places?.length]);
}

const TOP_N = 50;

/**
 * Send rerank request with the FULL place_profile payload (Phase 6.5).
 * The LLM judges holistically — features, theme_insights, tldr, pros,
 * cons all flow through.
 *
 * Boost post-process is gone (Phase 6.5). User curation surfaces via
 * the UI hint chips (parse-query.boosts → AiSearchInput), not via
 * hidden scoring.
 */
async function runRerank({
  semanticIntent,
  places,
  onSuccess,
  onError,
}: {
  semanticIntent: string;
  places: Place[];
  onSuccess: (rows: { id: string; score: number; why: string }[]) => void;
  onError: () => void;
}) {
  // Cap. Server-side /api/places is sorted by google_rating DESC when
  // AI search is active, so the top TOP_N are the highest-quality
  // candidates by Google's metric — best starting point for LLM judging.
  const capped = places.slice(0, TOP_N);

  const candidates = capped.map((p) => {
    const profile = (p.google_data?.place_profile ?? null) as
      | {
          searchable_summary?: string | null;
          features?: Record<string, unknown> | null;
          theme_insights?: unknown[] | null;
          tldr?: string | null;
          pros?: string[] | null;
          cons?: string[] | null;
        }
      | null;
    return {
      id: p.id,
      name: p.name,
      searchable_summary: profile?.searchable_summary ?? "",
      features: profile?.features ?? {},
      theme_insights: profile?.theme_insights ?? null,
      tldr: profile?.tldr ?? null,
      pros: profile?.pros ?? null,
      cons: profile?.cons ?? null,
    };
  });

  try {
    const res = await fetch("/api/ai/rank-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        semantic_intent: semanticIntent,
        candidates,
      }),
    });
    if (!res.ok) throw new Error(`rank-results ${res.status}`);
    const body = (await res.json()) as RankResultsOutput;
    onSuccess(body.ranked);
  } catch (e) {
    console.error("[ai-search] rerank failed:", e);
    onError();
  }
}
