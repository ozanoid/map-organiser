"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelKind, ChannelResult, NotificationSettingsView } from "@/lib/notify/types";

/** Settings → Notifications and "Send to me" (Phase 3, slice 1). */
export const NOTIFICATIONS_KEY = ["notifications"] as const;

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Something went wrong — try again.");
  return body;
}

/** The user's channels. `waitForTelegram`: ask again every 3 s until the
 *  Telegram chat is linked (the user pressing Start in the bot). */
export function useNotificationSettings(opts: { waitForTelegram?: boolean } = {}) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => fetch("/api/notifications").then(answer<NotificationSettingsView>),
    refetchInterval: (query) => {
      const view = query.state.data;
      const linked = view?.open && view.telegram.linked && !view.telegram.blocked;
      return opts.waitForTelegram && !linked ? 3000 : false;
    },
  });
}

export function useSetEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      fetch("/api/notifications/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).then(answer<{ status: "sent" | "already_confirmed" }>),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useRemoveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetch("/api/notifications/email", { method: "DELETE" }).then(answer<{ ok: true }>),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

/** The bot's start link (one-time, 15 minutes). */
export function useTelegramLink() {
  return useMutation({
    mutationFn: () => fetch("/api/notifications/telegram", { method: "POST" }).then(answer<{ url: string }>),
  });
}

export function useUnlinkTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetch("/api/notifications/telegram", { method: "DELETE" }).then(answer<{ ok: true }>),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useSendTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: ChannelKind) =>
      fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      }).then(answer<ChannelResult>),
    // A blocked bot shows up as a failed test: the screen should say so.
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useSendPlan(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channels: ChannelKind[]) =>
      fetch(`/api/plans/${planId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      }).then(answer<{ plan: { id: string; name: string }; results: ChannelResult[] }>),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
