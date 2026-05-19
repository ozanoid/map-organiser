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
 * Flow:
 *   1. POST /api/ai/parse-query with the raw query.
 *   2. Apply the returned `hard` + `soft_features` to the filter URL state.
 *   3. Save semantic_intent + needsRerank into the AI search store.
 *
 * The actual rerank step is triggered by `useAiRerankOrchestrator()` once
 * the places list refetches with the new filters — see below.
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
      // Build the next PlaceFilters from parse output.
      const nextFilters: Partial<PlaceFilters> = {
        // Always clear existing slots first (so a new NL search starts clean).
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
        soft_features: {
          atmosphere: data.soft_features.atmosphere,
          dietary: data.soft_features.dietary,
          occasions: data.soft_features.occasions,
          seating: data.soft_features.seating,
          cuisine_types: data.soft_features.cuisine_types,
        },
      };

      // Drop empty arrays; setFilters treats them as clear signals.
      if (nextFilters.soft_features) {
        for (const k of Object.keys(nextFilters.soft_features) as Array<
          keyof NonNullable<PlaceFilters["soft_features"]>
        >) {
          const v = nextFilters.soft_features[k];
          if (!Array.isArray(v) || v.length === 0) {
            delete nextFilters.soft_features[k];
          }
        }
        if (Object.keys(nextFilters.soft_features).length === 0) {
          nextFilters.soft_features = undefined;
        }
      }

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
  const boosts = useAiSearchStore((s) => s.boosts);
  const applyRankings = useAiSearchStore((s) => s.applyRankings);
  const failRerank = useAiSearchStore((s) => s.failRerank);

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
      boosts,
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

async function runRerank({
  semanticIntent,
  places,
  boosts,
  onSuccess,
  onError,
}: {
  semanticIntent: string;
  places: Place[];
  boosts: {
    matching_tag_ids: string[];
    matching_list_ids: string[];
    matching_subcategory_ids: string[];
  };
  onSuccess: (rows: { id: string; score: number; why: string }[]) => void;
  onError: () => void;
}) {
  // Cap by recency. Newest first — Place doesn't always carry updated_at on
  // the client, so fall back to created_at order from /api/places.
  const capped = places.slice(0, TOP_N);

  const candidates = capped.map((p) => {
    const profile = p.google_data?.place_profile as
      | { searchable_summary?: string | null }
      | undefined;
    return {
      id: p.id,
      name: p.name,
      searchable_summary: profile?.searchable_summary ?? "",
      // Sub-cat is on the place row directly; server uses this for the
      // sub-cat boost without an extra Supabase query.
      subcategory_id: p.subcategory_id ?? null,
    };
  });

  const hasBoosts =
    boosts.matching_tag_ids.length > 0 ||
    boosts.matching_list_ids.length > 0 ||
    boosts.matching_subcategory_ids.length > 0;

  try {
    const res = await fetch("/api/ai/rank-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        semantic_intent: semanticIntent,
        candidates,
        ...(hasBoosts
          ? {
              boost_tag_ids: boosts.matching_tag_ids,
              boost_list_ids: boosts.matching_list_ids,
              boost_subcategory_ids: boosts.matching_subcategory_ids,
            }
          : {}),
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
