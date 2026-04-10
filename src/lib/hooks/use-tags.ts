"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tag } from "@/lib/types";

export function useTags() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTag() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("tags")
        .insert({ name, user_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useDeleteTag() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase.from("tags").delete().eq("id", tagId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}

export function usePlaceTags(placeId: string | undefined) {
  return useQuery({
    queryKey: ["place-tags", placeId],
    queryFn: async (): Promise<Tag[]> => {
      const res = await fetch(`/api/places/${placeId}`);
      if (!res.ok) throw new Error("Failed to fetch place");
      const place = await res.json();
      return place.tags || [];
    },
    enabled: !!placeId,
  });
}

export function useTogglePlaceTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      placeId,
      tagId,
      currentTagIds,
    }: {
      placeId: string;
      tagId: string;
      currentTagIds: string[];
    }) => {
      const hasTag = currentTagIds.includes(tagId);
      const tag_ids = hasTag
        ? currentTagIds.filter((id) => id !== tagId)
        : [...currentTagIds, tagId];

      const res = await fetch(`/api/places/${placeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update place tags");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["place-tags", variables.placeId] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
