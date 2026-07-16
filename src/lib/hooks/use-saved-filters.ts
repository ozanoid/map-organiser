"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SavedFilter } from "@/lib/types";

/**
 * v1.20.0 (S2 F-03/NF-20/21) — saved filter presets.
 *
 * Direct browser-client CRUD like use-tags/use-lists: `saved_filters`
 * is a simple owner-scoped table and RLS (`auth.uid() = user_id`)
 * covers it — no API route needed.
 *
 * `query_string` stores the URL-shape serialization from
 * `filtersToQueryString` (same format the filter-persist store uses).
 * `ai_query` is non-null when the preset was saved from an AI search —
 * a chip with it re-runs the AI pipeline (rankings are session-only
 * and never stored).
 */

export function useSavedFilters() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["saved-filters"],
    queryFn: async (): Promise<SavedFilter[]> => {
      const { data, error } = await supabase
        .from("saved_filters")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}

export function useCreateSavedFilter() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      query_string: string;
      ai_query?: string | null;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("saved_filters")
        .insert({
          name: input.name,
          query_string: input.query_string,
          ai_query: input.ai_query ?? null,
          user_id: user.id,
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique (user_id, name)
        if (error.code === "23505") {
          throw new Error("You already have a saved filter with that name");
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-filters"] });
    },
  });
}

export function useDeleteSavedFilter() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("saved_filters")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-filters"] });
    },
  });
}
