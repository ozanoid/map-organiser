"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { PlaceList } from "@/lib/types";

export function useLists() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["lists"],
    queryFn: async (): Promise<PlaceList[]> => {
      const { data, error } = await supabase
        .from("lists")
        .select("*, list_places(count)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []).map((list) => ({
        ...list,
        place_count: (list.list_places as unknown as { count: number }[])?.[0]?.count || 0,
      }));
    },
  });
}

export function useCreateList() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; description?: string; color?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("lists")
        .insert({ ...input, user_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteList() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string) => {
      const { error } = await supabase.from("lists").delete().eq("id", listId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useAddToList() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, placeId }: { listId: string; placeId: string }) => {
      const { error } = await supabase
        .from("list_places")
        .insert({ list_id: listId, place_id: placeId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}

export function useRemoveFromList() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, placeId }: { listId: string; placeId: string }) => {
      const { error } = await supabase
        .from("list_places")
        .delete()
        .eq("list_id", listId)
        .eq("place_id", placeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}

export function useReorderListPlaces() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, placeIds }: { listId: string; placeIds: string[] }) => {
      const res = await fetch(`/api/lists/${listId}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}

export function usePlaceLists(placeId: string | undefined) {
  return useQuery({
    queryKey: ["place-lists", placeId],
    queryFn: async (): Promise<PlaceList[]> => {
      const res = await fetch(`/api/places/${placeId}`);
      if (!res.ok) throw new Error("Failed to fetch place");
      const place = await res.json();
      return place.lists || [];
    },
    enabled: !!placeId,
  });
}
