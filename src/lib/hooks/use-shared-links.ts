"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface SharedLink {
  id: string;
  slug: string;
  resource_type: "list" | "trip";
  resource_id: string;
  is_active: boolean;
  view_count: number;
  created_at: string;
}

export function useSharedLink(resourceType: "list" | "trip", resourceId: string | undefined) {
  return useQuery({
    queryKey: ["shared-link", resourceType, resourceId],
    queryFn: async (): Promise<SharedLink | null> => {
      // We create on demand, so just check if it exists by trying to create
      // The API returns existing link if one already exists
      return null;
    },
    enabled: false, // Manual fetch only
  });
}

export function useCreateSharedLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      resource_type,
      resource_id,
    }: {
      resource_type: "list" | "trip";
      resource_id: string;
    }): Promise<SharedLink> => {
      const res = await fetch("/api/shared", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_type, resource_id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create link");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["shared-link", data.resource_type, data.resource_id],
        data
      );
    },
  });
}

export function useToggleSharedLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      is_active,
    }: {
      id: string;
      is_active: boolean;
    }): Promise<SharedLink> => {
      const res = await fetch("/api/shared", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active }),
      });
      if (!res.ok) throw new Error("Failed to toggle link");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["shared-link", data.resource_type, data.resource_id],
        data
      );
    },
  });
}

export function useSaveSharedContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string): Promise<{ type: string; id: string }> => {
      const res = await fetch(`/api/shared/${slug}/save`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
