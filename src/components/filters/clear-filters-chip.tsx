"use client";

import { useFilters } from "@/lib/hooks/use-filters";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";
import { X } from "lucide-react";

/**
 * v1.23.0 (mobile UX): one-tap "clear everything" chip shown NEXT TO the
 * mobile Filters button — clearing shouldn't require opening the sheet.
 *
 * A separate 36px target beats an ✕ nested inside the Filters button:
 * button-in-button is invalid HTML, the tap target would be tiny, and
 * "does ✕ close or clear?" is ambiguous. The green dot on Filters stays
 * as the "active" signal; this chip is the action.
 *
 * Clears BOTH the URL filters and the AI-search store — the store half
 * is what un-sticks an assistant-pushed view (rankings survive
 * clearFilters alone; the grid would keep hiding/sorting by stale
 * scores, which is exactly the "clear doesn't clear" bug on mobile).
 */
export function ClearFiltersChip({ className = "" }: { className?: string }) {
  const { clearFilters, hasActiveFilters } = useFilters();
  const aiActive = useAiSearchStore((s) => s.rankings !== null || s.lastQuery !== null);
  const resetAiSearch = useAiSearchStore((s) => s.reset);

  if (!hasActiveFilters && !aiActive) return null;

  return (
    <button
      type="button"
      onClick={() => {
        clearFilters();
        resetAiSearch();
      }}
      aria-label="Clear all filters"
      title="Clear all filters"
      className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer transition-colors ${className}`}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
