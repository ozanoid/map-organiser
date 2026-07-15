"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { countTopicMatches } from "@/lib/places/topic-match";
import type { GoogleReview } from "@/lib/types";

/**
 * NF-03 — review topic chips ("People mention").
 *
 * v1.18.0 count semantics: Google's topic counts are aggregates over the
 * place's ENTIRE review pool — juxtaposing them with a local filter
 * produced on-screen contradictions ("scallop ceviche (5)" → 0 results).
 * The paren count is now the LOCAL match count (same token-AND matcher
 * the filter uses — consistent by construction); ORDERING still follows
 * Google's counts (they carry the salience signal). Topics with zero
 * local matches render muted and non-clickable.
 */
export function PlaceTopics({
  topics,
  reviews,
  activeTopic,
  onTopicClick,
}: {
  topics: Record<string, number>;
  reviews: GoogleReview[];
  activeTopic?: string | null;
  onTopicClick?: (topic: string | null) => void;
}) {
  if (Object.keys(topics).length === 0) return null;

  const texts = reviews.map((r) => r.text);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">People mention</h2>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(topics)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([topic]) => {
            const localCount = countTopicMatches(texts, topic);
            const isActive = activeTopic === topic;
            const clickable = localCount > 0;
            return (
              <button
                key={topic}
                type="button"
                disabled={!clickable}
                onClick={() => onTopicClick?.(isActive ? null : topic)}
                className={clickable ? "cursor-pointer" : "cursor-default"}
                aria-pressed={isActive}
                title={
                  clickable
                    ? undefined
                    : "Topic comes from Google's full review pool — no match in your stored reviews"
                }
              >
                <Badge
                  variant={isActive ? "default" : "secondary"}
                  className={cn(
                    "text-[10px] gap-1 transition-colors",
                    isActive
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : clickable
                        ? "hover:bg-secondary/80"
                        : "opacity-45"
                  )}
                >
                  {topic}
                  <span
                    className={cn(
                      isActive ? "text-emerald-100" : "text-muted-foreground"
                    )}
                  >
                    ({localCount})
                  </span>
                </Badge>
              </button>
            );
          })}
      </div>
    </section>
  );
}
