"use client";

import { useFilters } from "@/lib/hooks/use-filters";
import type { VisitStatus } from "@/lib/types";
import { Bookmark, CalendarCheck, CheckCircle2, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

const statuses: { value: VisitStatus | undefined; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
  { value: undefined, label: "All" },
  { value: "want_to_go", label: "Want to Go", icon: Bookmark },
  { value: "booked", label: "Booked", icon: CalendarCheck },
  { value: "visited", label: "Visited", icon: CheckCircle2 },
  { value: "favorite", label: "Favorite", icon: Heart },
];

export function VisitStatusFilter() {
  const { filters, setFilters } = useFilters();

  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((status) => {
        const isActive = filters.visit_status === status.value;
        const Icon = status.icon;

        return (
          <button
            key={status.label}
            onClick={() => setFilters({ visit_status: isActive ? undefined : status.value })}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
              isActive
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {status.label}
          </button>
        );
      })}
    </div>
  );
}
