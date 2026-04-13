"use client";

import { cn } from "@/lib/utils";
import { Bookmark, CalendarCheck, CheckCircle2, Heart } from "lucide-react";
import type { VisitStatus } from "@/lib/types";

const statuses: {
  value: VisitStatus;
  label: string;
  icon: typeof Bookmark;
  activeColor: string;
  activeBg: string;
}[] = [
  {
    value: "want_to_go",
    label: "Want to Go",
    icon: Bookmark,
    activeColor: "text-amber-600",
    activeBg: "bg-amber-50 border-amber-200",
  },
  {
    value: "booked",
    label: "Booked",
    icon: CalendarCheck,
    activeColor: "text-blue-600",
    activeBg: "bg-blue-50 border-blue-200",
  },
  {
    value: "visited",
    label: "Visited",
    icon: CheckCircle2,
    activeColor: "text-emerald-600",
    activeBg: "bg-emerald-50 border-emerald-200",
  },
  {
    value: "favorite",
    label: "Favorite",
    icon: Heart,
    activeColor: "text-red-500",
    activeBg: "bg-red-50 border-red-200",
  },
];

interface VisitStatusToggleProps {
  value: VisitStatus | null;
  onChange: (status: VisitStatus | null) => void;
  size?: "sm" | "md";
}

export function VisitStatusToggle({
  value,
  onChange,
  size = "md",
}: VisitStatusToggleProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((status) => {
        const isActive = value === status.value;
        const Icon = status.icon;
        return (
          <button
            key={status.value}
            type="button"
            onClick={() => onChange(isActive ? null : status.value)}
            aria-pressed={isActive}
            className={cn(
              "flex items-center gap-1 border rounded-full cursor-pointer transition-all",
              size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-1.5 text-sm",
              isActive
                ? `${status.activeBg} ${status.activeColor}`
                : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            <Icon
              className={cn(
                size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
                isActive && status.value === "favorite" && "fill-current"
              )}
            />
            {status.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small badge for display only (e.g. on PlaceCard) */
export function VisitStatusBadge({
  status,
}: {
  status: VisitStatus;
}) {
  const config = statuses.find((s) => s.value === status);
  if (!config) return null;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
        config.activeBg,
        config.activeColor
      )}
    >
      <Icon
        className={cn(
          "h-2.5 w-2.5",
          status === "favorite" && "fill-current"
        )}
      />
      {config.label}
    </span>
  );
}
