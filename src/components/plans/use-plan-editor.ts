"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useChangePlan } from "@/lib/hooks/use-plans";
import type { PlanChanges } from "@/lib/plans/schema";

/**
 * Applies a change to a plan and reports a failure the same way everywhere:
 * the server's message as a toast (it says what was wrong — "day 2 still
 * has 3 stop(s); move or remove them first").
 */
export function usePlanEditor(planId: string) {
  const { mutate, isPending } = useChangePlan(planId);

  const apply = useCallback(
    (changes: PlanChanges, opts: { onDone?: () => void; onFail?: () => void } = {}) =>
      mutate(changes, {
        onSuccess: () => opts.onDone?.(),
        onError: (e) => {
          toast.error(e.message);
          opts.onFail?.();
        },
      }),
    [mutate]
  );

  return { apply, isPending };
}

/** How long a toast that offers "Undo" stays: the default 4 s is gone
 *  before the hand gets there. */
export const UNDO_TOAST_MS = 8000;

