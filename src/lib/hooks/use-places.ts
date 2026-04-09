"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Place, PlaceFilters, ParsedPlaceData } from "@/lib/types";

async function fetchPlaces(filters: PlaceFilters): Promise<Place[]> {
  const params = new URLSearchParams();
  if (filters.country) params.set("country", filters.country);
  if (filters.city) params.set("city", filters.city);
  if (filters.category_id) params.set("category", filters.category_id);
  if (filters.tag_ids?.length) params.set("tags", filters.tag_ids.join(","));
  if (filters.list_id) params.set("list", filters.list_id);
  if (filters.rating_min) params.set("rating", String(filters.rating_min));
  if (filters.search) params.set("q", filters.search);

  const res = await fetch(`/api/places?${params}`);
  if (!res.ok) throw new Error("Failed to fetch places");
  return res.json();
}

export function usePlaces(filters: PlaceFilters) {
  return useQuery({
    queryKey: ["places", filters],
    queryFn: () => fetchPlaces(filters),
  });
}

export function useParseLink() {
  return useMutation({
    mutationFn: async (url: string): Promise<ParsedPlaceData> => {
      const res = await fetch("/api/places/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to parse link");
      }
      return res.json();
    },
  });
}

interface CreatePlaceInput {
  name: string;
  address?: string;
  country?: string;
  city?: string;
  lat: number;
  lng: number;
  category_id?: string;
  rating?: number;
  notes?: string;
  google_place_id?: string;
  google_data?: Record<string, unknown>;
  source?: string;
  tag_ids?: string[];
  list_ids?: string[];
}

export function useCreatePlace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePlaceInput): Promise<Place> => {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create place");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
