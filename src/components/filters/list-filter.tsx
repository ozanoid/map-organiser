"use client";

import { useLists } from "@/lib/hooks/use-lists";
import { useFilters } from "@/lib/hooks/use-filters";

export function ListFilter() {
  const { data: lists = [] } = useLists();
  const { filters, setFilters } = useFilters();

  if (lists.length === 0) {
    return <p className="text-xs text-muted-foreground">No lists yet</p>;
  }

  return (
    <div className="relative">
      <select
        value={filters.list_id || ""}
        onChange={(e) =>
          setFilters({ list_id: e.target.value || undefined })
        }
        className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      >
        <option value="">All lists</option>
        {lists.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name} ({list.place_count || 0})
          </option>
        ))}
      </select>
      <svg
        className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
