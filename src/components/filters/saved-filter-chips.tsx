"use client";

import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  useSavedFilters,
  useDeleteSavedFilter,
} from "@/lib/hooks/use-saved-filters";

/**
 * v1.20.0 (NF-20/21) — saved-filter quick chips, mounted on /places
 * between the search/sort row and the grid.
 *
 * Click semantics:
 * - Plain preset → `router.push(?query_string)` — a full REPLACE of the
 *   active filters (setFilters merges partials; pushing the stored URL
 *   is the cleanest replace and is back/forward-safe — useFilters syncs
 *   URL → local).
 * - (Until v1.54.0 a preset saved from an AI search re-ran it — the
 *   `ai_query` column; none were ever saved, and the AI search is gone.)
 * - X on a chip deletes the preset (no confirm — one-tap undoable by
 *   re-saving; presets are cheap).
 *
 * Known edge (accepted): a filter tweak made <300ms before clicking a
 * chip can have a pending debounced URL sync that fires after the push
 * and reverts it — re-clicking the chip recovers. Fixing it would need
 * cross-instance debounce cancellation in useFilters.
 */
export function SavedFilterChips() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: savedFilters = [] } = useSavedFilters();
  const deleteSavedFilter = useDeleteSavedFilter();

  if (savedFilters.length === 0) return null;

  function applyPreset(qs: string) {
    // Replace-all: push the stored query string; useFilters picks it up
    // from the URL.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {savedFilters.map((sf) => (
        <span
          key={sf.id}
          className="inline-flex items-center shrink-0 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <button
            type="button"
            onClick={() => applyPreset(sf.query_string)}
            className="flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium cursor-pointer"
          >
            {sf.name}
          </button>
          <button
            type="button"
            onClick={() =>
              deleteSavedFilter.mutate(sf.id, {
                onSuccess: () => toast.success(`"${sf.name}" removed`),
              })
            }
            className="pr-2 pl-0.5 py-1 cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label={`Delete saved filter ${sf.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
