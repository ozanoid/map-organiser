"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Pending AI proposal as exposed by GET /api/user/ai-suggestions.
 * Rows are pre-aggregated server-side: same (type, lower(value), parent)
 * collapses into one entry with `occurrences` and an `ids` array of the
 * underlying queue rows.
 */
export interface AiSuggestion {
  key: string;
  type: "tag" | "subcategory";
  proposed_value: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  confidence: number;
  occurrences: number;
  latest_at: string;
  sample_place_name: string | null;
  ids: string[];
}

export function useAiSuggestions() {
  return useQuery({
    queryKey: ["ai-suggestions"],
    queryFn: async (): Promise<AiSuggestion[]> => {
      const res = await fetch("/api/user/ai-suggestions");
      if (!res.ok) throw new Error("Failed to load AI suggestions");
      const body = (await res.json()) as { suggestions: AiSuggestion[] };
      return body.suggestions;
    },
    staleTime: 30 * 1000,
  });
}

export function useAcceptAiSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/user/ai-suggestions/${id}/accept`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to accept suggestion");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] });
      // Acceptance creates a real tag or subcategory and assigns it to places.
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["subcategories"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}

export function useRejectAiSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/user/ai-suggestions/${id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to reject suggestion");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] });
    },
  });
}
