"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * NF-03 — review topic chips ("People mention"), sorted by mention count.
 * v1.18.0: chips are clickable — clicking a topic filters the reviews
 * section to reviews mentioning it (page owns the state; ReviewsSection
 * applies the filter). Click the active chip again to clear.
 */
export function PlaceTopics({
  topics,
  activeTopic,
  onTopicClick,
}: {
  topics: Record<string, number>;
  activeTopic?: string | null;
  onTopicClick?: (topic: string | null) => void;
}) {
  if (Object.keys(topics).length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">People mention</h2>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(topics)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([topic, count]) => {
            const isActive = activeTopic === topic;
            return (
              <button
                key={topic}
                type="button"
                onClick={() => onTopicClick?.(isActive ? null : topic)}
                className="cursor-pointer"
                aria-pressed={isActive}
              >
                <Badge
                  variant={isActive ? "default" : "secondary"}
                  className={cn(
                    "text-[10px] gap-1 transition-colors",
                    isActive
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "hover:bg-secondary/80"
                  )}
                >
                  {topic}
                  <span
                    className={cn(
                      isActive ? "text-emerald-100" : "text-muted-foreground"
                    )}
                  >
                    ({count})
                  </span>
                </Badge>
              </button>
            );
          })}
      </div>
    </section>
  );
}
