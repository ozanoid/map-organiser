"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNotificationSettings, useSendPlan } from "@/lib/hooks/use-notifications";
import type { ChannelKind, ChannelsView } from "@/lib/notify/types";
import type { Plan } from "@/lib/types";

const LABEL: Record<ChannelKind, string> = { email: "E-mail", telegram: "Telegram" };

/** A channel the plan can go to now: set up on the server, connected and confirmed. */
function ready(view: ChannelsView, channel: ChannelKind): boolean {
  return channel === "email"
    ? view.email.configured && Boolean(view.email.address) && view.email.confirmed
    : view.telegram.configured && view.telegram.linked && !view.telegram.blocked;
}

/**
 * "Send to me" (Phase 3, slice 1): the plan's summary to the owner's own
 * e-mail and/or Telegram. Only connected channels can be ticked; with none,
 * the dialog points to Settings → Notifications.
 */
export function SendPlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useNotificationSettings();
  const send = useSendPlan(plan.id);
  const [picked, setPicked] = useState<Set<ChannelKind> | null>(null);

  const available = data?.open ? (["email", "telegram"] as const).filter((c) => ready(data, c)) : [];
  // Until the user changes it, every connected channel is ticked.
  const chosen = picked ?? new Set<ChannelKind>(available);

  function toggle(channel: ChannelKind) {
    const next = new Set(chosen);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    setPicked(next);
  }

  function submit() {
    send.mutate([...chosen], {
      onSuccess: ({ results }) => {
        const sent = results.filter((r) => r.status === "sent" || r.status === "busy");
        const failed = results.filter((r) => r.status === "failed" || r.status === "not_connected");
        if (sent.length) toast.success(`Sent to ${sent.map((r) => LABEL[r.channel]).join(" and ")}`);
        for (const r of failed) {
          toast.error(`${LABEL[r.channel]}: ${r.status === "not_connected" ? "not connected" : (r.error ?? "couldn't send")}`);
        }
        if (sent.length) onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to me</DialogTitle>
          <DialogDescription>
            A summary of “{plan.name}” — its days, stops, times and map links, in Turkish.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : error || !data ? (
          <p className="text-sm text-destructive">Couldn&apos;t load your channels — try again.</p>
        ) : !data.open ? (
          <p className="text-sm text-muted-foreground">Sending is only open to this app&apos;s owner.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect your e-mail or Telegram first, in{" "}
            <Link
              href="/settings?tab=notifications"
              className="font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
              onClick={() => onOpenChange(false)}
            >
              Settings → Notifications
            </Link>
            .
          </p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="sr-only">Where to send it</legend>
            {(["email", "telegram"] as const).map((channel) => {
              const enabled = available.includes(channel);
              const Icon = channel === "email" ? Mail : Send;
              const to =
                channel === "email" ? data.email.address : data.telegram.username ? `@${data.telegram.username}` : null;
              return (
                <label
                  key={channel}
                  className={`flex min-h-11 items-center gap-3 rounded-md px-2 ${
                    enabled ? "cursor-pointer hover:bg-muted" : "opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-600"
                    disabled={!enabled}
                    checked={enabled && chosen.has(channel)}
                    onChange={() => toggle(channel)}
                  />
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm">{LABEL[channel]}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {enabled ? to : "Not connected"}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={send.isPending || chosen.size === 0 || available.length === 0}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
