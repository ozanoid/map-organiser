"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { VisitEditInput, VisitLogInput } from "@/lib/visits/schema";
import type { PlaceVisitSummary, Visit } from "@/lib/types";

/**
 * Visits — server state.
 *
 *   ["visits", { placeId }]   a place's visits, newest first
 *
 * A visit write also changes the place's visit status and rating and,
 * through its stop, a plan — so every write refreshes those caches too, and
 * returns the place's new summary for a screen that holds the place itself.
 */

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error || fallback);
}

export function useVisits(placeId: string | undefined) {
  return useQuery({
    queryKey: ["visits", { placeId }],
    queryFn: async (): Promise<Visit[]> => {
      const res = await fetch(`/api/visits?place_id=${placeId}`);
      if (!res.ok) throw await readError(res, "Failed to load visits");
      return res.json();
    },
    enabled: !!placeId,
  });
}

function refreshAfterVisitWrite(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["visits"] });
  // A stop may have become done or planned again.
  queryClient.invalidateQueries({ queryKey: ["plan"] });
  // Visit status and rating show on cards, the map and filters.
  queryClient.invalidateQueries({ queryKey: ["places"] });
}

export interface VisitWriteResult {
  visit: Visit;
  created: boolean;
  place: PlaceVisitSummary;
}

/** Logs a visit — or updates the place's visit on that day. */
export function useLogVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VisitLogInput): Promise<VisitWriteResult> => {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Couldn't save the visit");
      return res.json();
    },
    onSuccess: () => refreshAfterVisitWrite(queryClient),
  });
}

export function useEditVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...changes }: VisitEditInput & { id: string }): Promise<VisitWriteResult> => {
      const res = await fetch(`/api/visits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw await readError(res, "Couldn't save the visit");
      return res.json();
    },
    onSuccess: () => refreshAfterVisitWrite(queryClient),
  });
}

export function useDeleteVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ place: PlaceVisitSummary; reopened_stop_id: string | null }> => {
      const res = await fetch(`/api/visits/${id}`, { method: "DELETE" });
      if (!res.ok) throw await readError(res, "Couldn't delete the visit");
      return res.json();
    },
    onSuccess: () => refreshAfterVisitWrite(queryClient),
  });
}
