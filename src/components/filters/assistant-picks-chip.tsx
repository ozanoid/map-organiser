"use client";

import { Sparkles, X } from "lucide-react";
import { useFilters } from "@/lib/hooks/use-filters";

/**
 * Shown while the view is narrowed to the places the assistant put on the
 * map ("Show on map" → ?ids=…). One tap returns to every place; the other
 * filters stay as they are.
 */
export function AssistantPicksChip({ className = "" }: { className?: string }) {
  const { filters, setFilters } = useFilters();
  const count = filters.ids?.length ?? 0;
  if (!count) return null;
  return (
    <button
      type="button"
      onClick={() => setFilters({ ids: undefined })}
      aria-label={`Showing ${count} places from the assistant. Show all places`}
      className={`h-9 shrink-0 inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40 cursor-pointer transition-colors ${className}`}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {count} from the assistant
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
