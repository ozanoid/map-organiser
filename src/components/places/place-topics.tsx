"use client";

import { Badge } from "@/components/ui/badge";

/**
 * NF-03 — review topic chips ("People mention"), sorted by mention count.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor) — behavior
 * unchanged. (Click-to-filter-reviews interaction: S1-PR2.)
 */
export function PlaceTopics({
  topics,
}: {
  topics: Record<string, number>;
}) {
  if (Object.keys(topics).length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">People mention</h2>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(topics)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([topic, count]) => (
            <Badge key={topic} variant="secondary" className="text-[10px] gap-1">
              {topic}
              <span className="text-muted-foreground">({count})</span>
            </Badge>
          ))}
      </div>
    </section>
  );
}
