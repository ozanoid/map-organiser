"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { openStatus, type Timetable } from "@/lib/places/open-now";

/**
 * NF-04 — business status + verified badges.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor), reworked after
 * review, then completed in v1.18.0:
 *
 * - PERSISTENT states (temporarily_closed / closed_forever from
 *   `current_status`) are the dead-place signal — always dominant.
 * - The v1.18.0 live badge is the HONEST replacement for the removed
 *   crawl-snapshot "Open now": computed at render time from the stored
 *   structured timetable in the PLACE's own timezone
 *   (src/lib/places/open-now.ts). Renders nothing when unknown.
 * - Verified (is_claimed) is independent of both.
 */
export function PlaceStatusBadges({
  currentStatus,
  isClaimed,
  timetable,
  tz,
}: {
  currentStatus?: string;
  isClaimed?: boolean;
  timetable?: Timetable;
  tz?: string;
}) {
  const persistent =
    currentStatus === "temporarily_closed" ||
    currentStatus === "closed_forever";

  // A 60s tick keeps the badge honest on parked tabs — without it,
  // "Open now · closes 17:00" would keep rendering long past 17:00
  // (openStatus captures the time at call).
  const [now, setNow] = useState(() => new Date());
  const canGoLive = !persistent && !!timetable && !!tz;
  useEffect(() => {
    if (!canGoLive) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [canGoLive]);

  // Live status only matters for operating places — a permanently closed
  // venue's timetable is stale noise.
  const live = persistent ? null : openStatus(timetable, tz, now);

  if (!persistent && !live && !isClaimed) return null;

  const pad = (n: number) => String(n).padStart(2, "0");

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
      {live && (
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              live.open ? "bg-green-500" : "bg-gray-400"
            }`}
          />
          <span className="text-xs font-medium">
            {live.open
              ? live.closesAt
                ? `Open now · closes ${pad(live.closesAt.hour)}:${pad(live.closesAt.minute)}`
                : "Open 24 hours"
              : "Closed now"}
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
