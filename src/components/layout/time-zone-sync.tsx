"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NOTIFICATIONS_KEY } from "@/lib/hooks/use-notifications";

const SYNCED = "time-zone-synced";

/**
 * Tells the server this browser's time zone, once per device and zone
 * (Phase 3, slice 2): the weekly summary and the reminders of a plan without
 * a located place are timed in it. The server keeps it only while the
 * profile has none, so a zone chosen in Settings stays. Settings, if it is
 * open, reads the zone again once it is stored. Renders nothing.
 */
export function TimeZoneSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    let synced: string | null = null;
    try {
      synced = localStorage.getItem(SYNCED);
    } catch {
      // storage blocked: send it — the server keeps the first zone anyway
    }
    if (synced === zone) return;
    void fetch("/api/user/time-zone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone: zone, auto: true }),
    })
      .then((res) => {
        if (!res.ok) return;
        void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        try {
          localStorage.setItem(SYNCED, zone);
        } catch {
          // fine: it is asked again next time
        }
      })
      .catch(() => {});
  }, [qc]);
  return null;
}
