"use client";

import { Star } from "lucide-react";

/**
 * NF-01 — 1-5 star vote distribution as horizontal CSS bars
 * (Google Play / Amazon style). Renders nothing without data.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor) — behavior
 * unchanged.
 */
export function RatingDistributionBar({
  distribution,
}: {
  distribution: Record<string, number>;
}) {
  // Empty-object guard (matches sibling widgets) — makes the
  // "renders nothing without data" contract actually true.
  if (Object.keys(distribution).length === 0) return null;

  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Rating Breakdown</h2>
      <div className="space-y-1">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = distribution[String(star)] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-right text-muted-foreground">
                {star}
              </span>
              <Star className="h-3 w-3 text-orange-400 fill-orange-400" />
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 text-right text-muted-foreground tabular-nums">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
