"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Subcategory } from "@/lib/types";

/**
 * useSubcategories — fetches the user's subcategories (default + custom).
 *
 * Pending AI proposals (is_pending=true) are excluded by default since
 * those should only appear in the Phase 5 moderation queue.
 */
export function useSubcategories(options?: { includePending?: boolean }) {
  const supabase = createClient();
  const includePending = options?.includePending ?? false;

  return useQuery({
    queryKey: ["subcategories", { includePending }],
    queryFn: async (): Promise<Subcategory[]> => {
      let query = supabase
        .from("subcategories")
        .select("*")
        .order("name", { ascending: true });

      if (!includePending) {
        query = query.eq("is_pending", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateSubcategory() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      parent_category_id: string;
      name: string;
      slug: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("subcategories")
        .insert({
          ...input,
          user_id: user.id,
          is_default: false,
          is_pending: false,
          approved_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subcategories"] });
    },
  });
}

export function useDeleteSubcategory() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("subcategories")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subcategories"] });
      // places carry joined subcategory data — invalidate so cards refresh.
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
