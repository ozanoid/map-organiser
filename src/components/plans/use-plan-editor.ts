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

/**
 * Icon-only button: 36 px visible, 44 px hit area (the `after` layer), so it
 * can sit in a dense row and still be tapped reliably.
 */
export const ICON_BUTTON =
  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground " +
  "transition-colors hover:bg-accent hover:text-foreground cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent " +
  "after:absolute after:-inset-1 after:content-['']";
