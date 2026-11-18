"use client";

import { useIsMutating, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { routeSignature } from "@/lib/plans/route-signature";
import type { PlanChanges } from "@/lib/plans/schema";
import type { Plan, PlanRoute } from "@/lib/types";

/**
 * Plans — server state.
 *
 *   ["plans"]                         the list
 *   ["plan", id]                      one plan with days and stops
 *   ["plan-route", dayId, signature]  one day's route
 *
 * Every edit goes through useChangePlan → PATCH /api/plans/[id], which
 * answers with the plan as it is afterwards; that answer replaces the
 * cached plan, so there is no refetch and nothing to patch by hand.
 *
 * Everything that writes to one plan — a change, Auto Plan, AI Plan — shares
 * a mutation key and a scope: they run one after another, so their answers
 * can't arrive out of order and leave an older state in the cache.
 *
 * Routes are cached under what they depend on (the day's located stops, in
 * order, and its routing profile), so only an edit that moves a stop asks
 * Mapbox for a new one.
 */

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error || fallback);
}

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: async (): Promise<Plan[]> => {
      const res = await fetch("/api/plans");
      if (!res.ok) throw await readError(res, "Failed to load plans");
      return res.json();
    },
  });
}

export function usePlan(id: string | undefined) {
  return useQuery({
    queryKey: ["plan", id],
    queryFn: async (): Promise<Plan | null> => {
      const res = await fetch(`/api/plans/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await readError(res, "Failed to load the plan");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      start_date?: string | null;
      day_count: number;
      list_id?: string;
    }): Promise<{ id: string }> => {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Failed to create the plan");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw await readError(res, "Failed to delete the plan");
    },
    onSuccess: (_data, id) => {
      // "Not found" from now on — a page still showing the plan, or a Back
      // to its URL, must not bring the deleted plan up from the cache.
      queryClient.setQueryData(["plan", id], null);
      return queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });
}

const changeKey = (planId: string) => ["plan-change", planId];

/**
 * What every write to a plan has in common: the shared key and scope, a
 * cancelled read (a slower GET that started earlier must not land on top of
 * the newer answer), and the answer going into the cache. `plan` is null
 * when the server committed the write but couldn't read the plan back — then
 * the cached plan is refetched instead.
 */
function usePlanWrite<Input, Output extends { plan: Plan | null }>(
  planId: string,
  mutationFn: (input: Input) => Promise<Output>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: changeKey(planId),
    scope: { id: `plan-${planId}` },
    mutationFn,
    onMutate: () => queryClient.cancelQueries({ queryKey: ["plan", planId] }),
    onSuccess: ({ plan }) => {
      if (plan) queryClient.setQueryData(["plan", planId], plan);
      else queryClient.invalidateQueries({ queryKey: ["plan", planId] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
    // A cancelled read left the cache as it was; a failed write may still
    // have raced with one. Read again.
    onError: () => queryClient.invalidateQueries({ queryKey: ["plan", planId] }),
  });
}

/** Applies `{ set, ops }` to a plan. */
export function useChangePlan(planId: string) {
  return usePlanWrite(
    planId,
    async (changes: PlanChanges): Promise<{ plan: Plan | null; added_stops: string[] }> => {
      const res = await fetch(`/api/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw await readError(res, "Couldn't save the change");
      return res.json();
    }
  );
}

/** True while a change to this plan is on its way — controls that compute
 *  their op from day numbers wait for it. */
export function usePlanBusy(planId: string): boolean {
  return useIsMutating({ mutationKey: changeKey(planId) }) > 0;
}

export function useAutoPlan(planId: string) {
  return usePlanWrite<void, { plan: Plan | null }>(planId, async () => {
    const res = await fetch(`/api/plans/${planId}/auto-plan`, { method: "POST" });
    if (!res.ok) throw await readError(res, "Failed to auto-plan");
    return res.json();
  });
}

export interface AiPlanResult {
  plan: Plan | null;
  days: { day_number: number; theme: string; place_count: number }[];
  placed: number;
  left_out: number;
  tips: string[];
}

/** AI Plan (POST /api/ai/day-plan). Takes seconds; other changes to the
 *  plan wait behind it. */
export function useAiPlan(planId: string) {
  return usePlanWrite(
    planId,
    async (input: { include_pool: boolean; city?: string }): Promise<AiPlanResult> => {
      const res = await fetch("/api/ai/day-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, ...input }),
      });
      if (!res.ok) throw await readError(res, "AI plan failed");
      return res.json();
    }
  );
}

/**
 * Routes of a plan's days, by day id. A day with fewer than two located
 * stops has none.
 *
 * A route is cached under the day's signature (routeSignature): two stops
 * swapping places, a stop joining or leaving, or a new profile change it; a
 * cost or a note doesn't. The signature goes to the server too, which
 * answers only for that arrangement.
 */
export function usePlanRoutes(plan: Plan | null | undefined): Record<string, PlanRoute | null | undefined> {
  const days = plan?.days ?? [];
  const results = useQueries({
    queries: days.map((day) => {
      const signature = routeSignature(day);
      return {
        queryKey: ["plan-route", day.id, signature],
        queryFn: async (): Promise<PlanRoute | null> => {
          const res = await fetch(
            `/api/plans/${plan!.id}/days/${day.id}/route?sig=${encodeURIComponent(signature ?? "")}`
          );
          if (!res.ok) throw await readError(res, "Failed to load the route");
          return (await res.json()).route;
        },
        enabled: signature !== null,
        // The key carries everything the route depends on.
        staleTime: Infinity,
        // An error is not remembered (unlike an answer): one more try now,
        // and again the next time the plan is opened.
        retry: 1,
      };
    }),
  });
  // undefined = still loading; null = no route (too few located stops, or
  // the request failed — the day is shown without one).
  const routes: Record<string, PlanRoute | null | undefined> = {};
  days.forEach((day, i) => {
    const result = results[i];
    routes[day.id] = routeSignature(day) === null || result?.isError ? null : result?.data;
  });
  return routes;
}
