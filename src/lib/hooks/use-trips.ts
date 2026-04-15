"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Trip } from "@/lib/types";

export function useTrips() {
  return useQuery({
    queryKey: ["trips"],
    queryFn: async (): Promise<Trip[]> => {
      const res = await fetch("/api/trips");
      if (!res.ok) throw new Error("Failed to fetch trips");
      return res.json();
    },
  });
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ["trip", id],
    queryFn: async (): Promise<Trip> => {
      const res = await fetch(`/api/trips/${id}`);
      if (!res.ok) throw new Error("Failed to fetch trip");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      start_date: string;
      end_date: string;
      list_id?: string;
      place_ids?: string[];
    }): Promise<Trip> => {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create trip");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

export function useDeleteTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete trip");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

export function useAutoPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string) => {
      const res = await fetch(`/api/trips/${tripId}/auto-plan`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to auto-plan");
      }
      return res.json();
    },
    onSuccess: (_data, tripId) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

export function useReorderTripDayPlaces() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      dayId,
      placeIds,
    }: {
      tripId: string;
      dayId: string;
      placeIds: string[];
    }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
    },
    onSuccess: (_data, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

export function useRemoveTripPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, placeId }: { tripId: string; dayId: string; placeId: string }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/places`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeId }),
      });
      if (!res.ok) throw new Error("Failed to remove place");
    },
    onSuccess: (_data, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

export function useAddTripPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, placeId }: { tripId: string; dayId: string; placeId: string }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeId }),
      });
      if (!res.ok) throw new Error("Failed to add place");
    },
    onSuccess: (_data, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

export function useMoveTripPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, placeId, targetDayId }: {
      tripId: string; dayId: string; placeId: string; targetDayId: string;
    }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/places`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeId, target_day_id: targetDayId }),
      });
      if (!res.ok) throw new Error("Failed to move place");
    },
    onSuccess: (_data, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}

export function useSwapTripDays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, direction }: { tripId: string; dayId: string; direction: "up" | "down" }) => {
      const res = await fetch(`/api/trips/${tripId}/swap-days`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayId, direction }),
      });
      if (!res.ok) throw new Error("Failed to swap days");
    },
    onSuccess: (_data, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });
}
