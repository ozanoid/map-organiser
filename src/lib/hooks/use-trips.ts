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
    // Cancel any in-flight trip refetch (e.g. from a just-saved cost or
    // profile toggle) so its stale payload can't clobber the optimistic
    // drag order the component holds in local state.
    onMutate: async ({ tripId }: { tripId: string; dayId: string; placeIds: string[] }) => {
      await queryClient.cancelQueries({ queryKey: ["trip", tripId] });
    },
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

// v1.22.0 (NF-07/AI-09): patch a single trip day (routing_profile, notes).
// onSuccess RETURNS the invalidation promise so isPending covers the
// refetch — the route-mode cycle button computes "next" from server
// state, and releasing it early let rapid clicks re-send the same value.
export function useUpdateTripDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, ...fields }: {
      tripId: string;
      dayId: string;
      routing_profile?: "walking" | "driving" | "cycling";
      notes?: string | null;
    }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Failed to update day");
      return res.json();
    },
    onSuccess: (_data, { tripId }) =>
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] }),
  });
}

// v1.22.0 (NF-08): in-place update of a trip-day place row (cost etc.).
// NO trip invalidation: a full refetch re-purchases one Mapbox Directions
// call per multi-place day just to show a number the client already has —
// patch the cached row instead.
export function useUpdateTripDayPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, dayId, placeId, ...fields }: {
      tripId: string;
      dayId: string;
      placeId: string;
      cost_estimate?: number | null;
      time_slot?: string | null;
      notes?: string | null;
    }) => {
      const res = await fetch(`/api/trips/${tripId}/days/${dayId}/places`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeId, ...fields }),
      });
      if (!res.ok) throw new Error("Failed to update place");
    },
    onSuccess: (_data, { tripId, dayId, placeId, ...fields }) => {
      queryClient.setQueryData(["trip", tripId], (old: Trip | undefined) => {
        if (!old?.days) return old;
        return {
          ...old,
          days: old.days.map((d) =>
            d.id !== dayId
              ? d
              : {
                  ...d,
                  places: (d.places ?? []).map((dp) =>
                    dp.place_id === placeId ? { ...dp, ...fields } : dp
                  ),
                }
          ),
        };
      });
    },
  });
}

// v1.22.0 (NF-08): update trip fields (party_size, name, notes…).
// Scalar updates merge the PATCH response into the cache — no ["trip"]
// invalidation (would re-purchase Directions per day) and the fresh
// party_size lands synchronously, so the stepper never steps from a
// stale prop.
export function useUpdateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, ...fields }: {
      tripId: string;
      name?: string;
      notes?: string | null;
      party_size?: number;
    }): Promise<Trip> => {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Failed to update trip");
      return res.json();
    },
    onSuccess: (data, { tripId }) => {
      queryClient.setQueryData(["trip", tripId], (old: Trip | undefined) =>
        old ? { ...old, ...data, days: old.days } : old
      );
      queryClient.invalidateQueries({ queryKey: ["trips"] });
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
