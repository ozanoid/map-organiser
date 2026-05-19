"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useAiSearchStore,
  BROADEN_THRESHOLD,
} from "@/lib/stores/ai-search-store";
import { useFilters } from "@/lib/hooks/use-filters";
import { usePlaces } from "@/lib/hooks/use-places";
import type { Place, PlaceFilters } from "@/lib/types";
import type { ParseQueryOutput } from "@/lib/ai/schemas/parse-query";
import type { RankResultsOutput } from "@/lib/ai/schemas/rank-results";

/**
 * Stable JSON fingerprint of a PlaceFilters object. Keys are sorted and
 * undefined values dropped so cosmetic differences don't cause false
 * mismatches in the orchestrator's targetFilters gate.
 */
function fpFilters(filters: PlaceFilters | null): string {
  if (!filters) return "<null>";
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(filters).sort()) {
    const v = (filters as Record<string, unknown>)[k];
    if (v !== undefined) obj[k] = v;
  }
  return JSON.stringify(obj);
}

/**
 * Mirror of useFilters.setFilters merge logic — used to compute the
 * EXACT post-merge filter set ahead of the actual state update, so we
 * can stash it as the AI search's `targetFilters`. The orchestrator
 * fingerprint-gate compares against this to wait out the race between
 * applyParse (zustand sync) and setFilters (React useState async).
 */
function mergeFiltersForTarget(
  prev: PlaceFilters,
  patch: Partial<PlaceFilters>
): PlaceFilters {
  const next: Record<string, unknown> = { ...prev };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") {
      delete next[key];
    } else if (Array.isArray(value) && value.length === 0) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next as PlaceFilters;
}

/**
 * Restricted hard filter axes. These are dropped when adaptive broaden
 * triggers (narrow result count < BROADEN_THRESHOLD). All other hard
 * fields (category, city, country, visit_status, rating thresholds,
 * created_after) are preserved.
 */
function hasRestrictedHard(filters: PlaceFilters): boolean {
  return (
    (filters.subcategory_ids?.length ?? 0) > 0 ||
    (filters.tag_ids?.length ?? 0) > 0 ||
    filters.list_id !== undefined
  );
}

function dropRestrictedHard(
  filters: PlaceFilters
): { broader: Partial<PlaceFilters>; droppedLabels: string[] } {
  const broader: Partial<PlaceFilters> = {
    ...filters,
    subcategory_ids: undefined,
    tag_ids: undefined,
    list_id: undefined,
  };
  const labels: string[] = [];
  if ((filters.subcategory_ids?.length ?? 0) > 0) labels.push("sub-category");
  if ((filters.tag_ids?.length ?? 0) > 0) labels.push("tag");
  if (filters.list_id) labels.push("list");
  return { broader, droppedLabels: labels };
}

/**
 * Submit a natural-language query.
 *
 * Flow (Phase 6.5 LLM-as-judge):
 *   1. POST /api/ai/parse-query with the raw query.
 *   2. Apply the returned `hard` to the filter URL state. Soft matching
 *      (atmosphere/occasions/etc.) no longer lives in URL — it's carried
 *      by `semantic_intent` and consumed by rank-results.
 *   3. Save semantic_intent + requires_semantic_ranking into the AI
 *      search store.
 *
 * The rerank step is triggered by `useAiRerankOrchestrator()` once the
 * places list refetches with the new filters — see below.
 *
 * `boosts` was removed in v1.8.1 (see schema docstring).
 */
export function useAiSearch() {
  const { setFilters, filters: currentFilters } = useFilters();
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

      // Compute the EXACT post-merge filter set so the orchestrator's
      // fingerprint gate has a deterministic target to wait for. Mirrors
      // the merge logic in useFilters.setFilters. See targetFilters
      // docstring in ai-search-store.
      const targetFilters = mergeFiltersForTarget(currentFilters, nextFilters);

      setFilters(nextFilters);
      applyParse({
        semantic_intent: data.semantic_intent,
        requires_semantic_ranking: data.requires_semantic_ranking,
        needs_clarification: data.needs_clarification,
        query,
        targetFilters,
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
  const broadenStatus = useAiSearchStore((s) => s.broadenStatus);
  const broaden = useAiSearchStore((s) => s.broaden);
  const targetFilters = useAiSearchStore((s) => s.targetFilters);
  const applyRankings = useAiSearchStore((s) => s.applyRankings);
  const failRerank = useAiSearchStore((s) => s.failRerank);
  const applyBroaden = useAiSearchStore((s) => s.applyBroaden);
  const resolveBroadenCheck = useAiSearchStore((s) => s.resolveBroadenCheck);
  const { setFilters } = useFilters();

  const { data: places, isFetching, status } = usePlaces(filters);

  // Lock to prevent concurrent runRerank invocations.
  //
  // Without this, the rerank effect can re-enter `runRerank` while a
  // previous call is still in flight, because `rerankStatus` only flips
  // to "ready" after the response lands. Re-entry triggers were observed:
  //   - React Strict Mode dev double-mount of effects
  //   - places refetch transition: cache-hit stale data → mid-fetch
  //     (isFetching=true window) → fresh data, with each tick re-running
  //     the effect because `places?.length` is in deps
  //   - applyParse + setFilters race: orchestrator can see broadenStatus
  //     "ready" before the new places fetch settles, fire on stale data,
  //     then re-fire when the fresh data lands.
  //
  // The ref guards against all three. It is reset by runRerank's success
  // and error callbacks below.
  const rerankInFlightRef = useRef(false);

  // ─── Phase 6.5 Slice 5: adaptive broaden gate ───
  // Runs BEFORE rerank. After parse-query lands and the narrow set is
  // fetched, we either: (a) apply broader filter and wait for refetch,
  // (b) decide no broaden is needed and let rerank proceed.
  useEffect(() => {
    if (!needsRerank) return;
    if (broadenStatus !== "checking") return;
    // CRITICAL: targetFilters fingerprint gate. See targetFilters
    // docstring in ai-search-store and v1.8.2 CHANGELOG for the empirical
    // race this guard catches (applyParse zustand-sync lands before
    // setFilters React-useState propagates).
    if (!targetFilters) return;
    if (fpFilters(filters) !== fpFilters(targetFilters)) return;
    if (isFetching) return;
    if (!places) return;

    // If broaden state already exists (we're in the broader-fetch phase),
    // record the broader count and mark the gate as ready.
    if (broaden !== null) {
      // First fetch after we applied broader filter — capture broader count.
      if (broaden.broaderCount === 0 && broaden.activeMode === "broader") {
        applyBroaden({ ...broaden, broaderCount: places.length });
      }
      resolveBroadenCheck();
      return;
    }

    // Decide whether to broaden.
    if (!hasRestrictedHard(filters) || places.length >= BROADEN_THRESHOLD) {
      resolveBroadenCheck();
      return;
    }

    // Trigger broaden: stash both filter sets and apply the broader one.
    const { broader, droppedLabels } = dropRestrictedHard(filters);
    applyBroaden({
      narrowFilters: { ...filters },
      broaderFilters: broader,
      narrowCount: places.length,
      broaderCount: 0, // populated when the broader fetch lands
      droppedLabels,
      activeMode: "broader",
    });
    setFilters(broader);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    needsRerank,
    broadenStatus,
    isFetching,
    places?.length,
    broaden,
    filters,
    targetFilters,
  ]);

  // ─── Rerank (runs after broaden gate is resolved) ───
  useEffect(() => {
    if (rerankStatus !== "pending") return;
    // Lock-out: prevent concurrent fires while a previous runRerank is
    // still in flight. See rerankInFlightRef comment above.
    if (rerankInFlightRef.current) return;
    if (!needsRerank) return;
    if (!semanticIntent) return;
    if (broadenStatus !== "ready") return;
    // CRITICAL: targetFilters fingerprint gate. See targetFilters
    // docstring in ai-search-store and v1.8.2 CHANGELOG for the empirical
    // race this guard catches.
    if (!targetFilters) return;
    if (fpFilters(filters) !== fpFilters(targetFilters)) return;
    if (status !== "success") return;
    if (isFetching) return;
    if (!places) return;

    if (places.length === 0) {
      applyRankings([]);
      return;
    }

    // Snapshot the targetFilters fingerprint at fire-time so we can
    // discard the response if the active target changed mid-flight
    // (new query, broaden toggle) — prevents stale rankings from
    // winning the race against a follow-up rerank.
    const targetFpAtFire = fpFilters(targetFilters);

    // Flip the lock BEFORE the await. Subsequent effect runs (Strict
    // Mode second invocation, dependency-driven re-runs) see the lock
    // and exit at the guard above.
    rerankInFlightRef.current = true;

    void runRerank({
      semanticIntent,
      places,
      onSuccess: (rows) => {
        rerankInFlightRef.current = false;
        const currentTargetFp = fpFilters(useAiSearchStore.getState().targetFilters);
        if (currentTargetFp !== targetFpAtFire) {
          // Stale — silently discard.
          return;
        }
        applyRankings(rows);
      },
      onError: () => {
        rerankInFlightRef.current = false;
        failRerank();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    needsRerank,
    semanticIntent,
    broadenStatus,
    rerankStatus,
    status,
    isFetching,
    places?.length,
    filters,
    targetFilters,
  ]);
}

const TOP_N = 50;

/**
 * Send rerank request with the FULL place_profile payload (Phase 6.5).
 * The LLM judges holistically — features, theme_insights, tldr, pros,
 * cons all flow through.
 *
 * Boost post-process (and the hint-chip UI it fed) was removed entirely
 * in v1.8.1. The rank-results LLM has all the context it needs to
 * surface user-curated matches via its own scoring.
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
