"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Backfill state shape from GET /api/user/backfill-profiles.
 */
export interface BackfillEligibility {
  total_places: number;
  has_profile: number;
  has_reviews_no_profile: number;
  has_cid_no_reviews: number;
  no_cid_no_profile: number;
  estimated_cost_usd: number;
  ai_features_enabled: boolean;
}

/**
 * Polled while a backfill is in flight so the count comes down in real
 * time. Server load is light (one COUNT-like scan per call), but we
 * still cap with `enabled` to avoid polling when the panel is closed.
 */
export function useBackfillEligibility(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["backfill-profiles", "eligibility"],
    queryFn: async (): Promise<BackfillEligibility> => {
      const res = await fetch("/api/user/backfill-profiles");
      if (!res.ok) throw new Error("Failed to load backfill eligibility");
      return res.json();
    },
    refetchInterval: options?.poll ? 5000 : false,
    staleTime: 15 * 1000,
  });
}

interface KickoffResult {
  queued: number;
  has_more: boolean;
  remaining_after?: number;
}

/**
 * Kick off a backfill batch. Returns when the server has dispatched
 * (fire-and-forget) the chunk; actual enrichment continues in the
 * background. Pair with useBackfillEligibility(poll: true) to track
 * the count coming down.
 */
export function useStartBackfill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (limit?: number): Promise<KickoffResult> => {
      const res = await fetch("/api/user/backfill-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Backfill failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Re-fetch eligibility so the count starts to come down immediately.
      // Places are invalidated too because they'll gain a profile.
      void queryClient.invalidateQueries({
        queryKey: ["backfill-profiles"],
      });
      void queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
