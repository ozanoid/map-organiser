"use client";

import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

/**
 * NF-04 — business status + verified badges.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor), then reworked
 * after review:
 *
 * - `current_status` is a CRAWL-TIME SNAPSHOT refreshed at most every
 *   30 days (opt-in cron) — rendering "Open now" / "Closed" from it in
 *   present tense was wrong most of the day. Only the PERSISTENT states
 *   (temporarily_closed / closed_forever) are shown; those are the
 *   valuable dead-place signal NF-04 is actually after. Live open/closed
 *   belongs to opening_hours, which the page already displays.
 * - The Verified (is_claimed) badge no longer hides when current_status
 *   is absent — they're independent facts. (The old inline block only
 *   rendered Verified inside the status gate, and status was never
 *   populated before the v1.17.0 extraction fix — so in practice this
 *   badge appears for the first time.)
 */
export function PlaceStatusBadges({
  currentStatus,
  isClaimed,
}: {
  currentStatus?: string;
  isClaimed?: boolean;
}) {
  const persistent =
    currentStatus === "temporarily_closed" ||
    currentStatus === "closed_forever";

  if (!persistent && !isClaimed) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {persistent && (
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              currentStatus === "temporarily_closed"
                ? "bg-amber-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs font-medium">
            {currentStatus === "temporarily_closed"
              ? "Temporarily closed"
              : "Permanently closed"}
          </span>
        </div>
      )}
      {isClaimed && (
        <Badge variant="outline" className="gap-1 text-[10px] py-0">
          <ShieldCheck className="h-3 w-3 text-blue-500" />
          Verified
        </Badge>
      )}
    </div>
  );
}
