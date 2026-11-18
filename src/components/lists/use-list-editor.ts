"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useChangeList } from "@/lib/hooks/use-lists";
import type { ListChanges } from "@/lib/lists/schema";

/**
 * Applies a change to a list and reports a failure the same way everywhere:
 * the server's message as a toast. The plan editor's twin
 * (src/components/plans/use-plan-editor.ts).
 */
export function useListEditor(listId: string) {
  const { mutate, isPending } = useChangeList(listId);

  const apply = useCallback(
    (changes: ListChanges, opts: { onDone?: () => void; onFail?: () => void } = {}) =>
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
