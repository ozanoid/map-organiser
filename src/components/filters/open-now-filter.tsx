"use client";

import { useFilters } from "@/lib/hooks/use-filters";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * v1.18.0 dynamic "Open now" toggle chip. Sets PlaceFilters.open_now;
 * /api/places evaluates isOpenNow (place-local time from stored
 * timetable + tz) at request time. Places without timetable data are
 * EXCLUDED while active — coverage grows as places refresh.
 */
export function OpenNowFilter() {
  const { filters, setFilters } = useFilters();
  const isActive = filters.open_now === true;

  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => setFilters({ open_now: isActive ? undefined : true })}
      className={cn(
        "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
        isActive
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
      )}
    >
      <Clock className="h-3 w-3" />
      Open now
    </button>
  );
}
