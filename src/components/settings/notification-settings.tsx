"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  useNotificationSettings,
  useRemoveEmail,
  useSendTest,
  useSetEmail,
  useTelegramLink,
  useUnlinkTelegram,
} from "@/lib/hooks/use-notifications";
import type { ChannelsView } from "@/lib/notify/types";

/**
 * Settings → Notifications (Phase 3, slice 1): where the app sends the
 * owner's plans — an e-mail address (confirmed by a link before anything
 * else goes to it) and a Telegram chat (linked through the bot's Start).
 */
export function NotificationSettings() {
  const [waitingForTelegram, setWaitingForTelegram] = useState(false);
  const { data, isLoading, error } = useNotificationSettings({ waitForTelegram: waitingForTelegram });

  // Back from the confirmation link: say how it went, then drop the flag
  // from the address so a refresh doesn't say it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("email");
    if (!result) return;
    if (result === "confirmed") toast.success("E-mail address confirmed");
    else toast.error("That confirmation link is invalid or expired — save the address again for a new one.");
    url.searchParams.delete("email");
    window.history.replaceState(null, "", url);
  }, []);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-sm text-destructive">Couldn&apos;t load your notification settings — try again.</p>;
  }

  const heading = (
    <div>
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold">Notifications</h2>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {data.open
          ? "Where the app sends your plans. Messages are in Turkish; nothing goes anywhere until you ask."
          : "Notifications are only open to this app's owner."}
      </p>
    </div>
  );
  if (!data.open) return heading;

  return (
    <div className="space-y-4">
      {heading}
      <Separator />
      <EmailChannel view={data.email} />
      <Separator />
      <TelegramChannel view={data.telegram} waiting={waitingForTelegram} onWaiting={setWaitingForTelegram} />
    </div>
  );
}

function ChannelHeading({ icon: Icon, title, status }: { icon: typeof Mail; title: string; status?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      {status}
    </div>
  );
}

// ── E-mail ─────────────────────────────────────────────────────────────

function EmailChannel({ view }: { view: ChannelsView["email"] }) {
  const setEmail = useSetEmail();
  const removeEmail = useRemoveEmail();
  const sendTest = useSendTest();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!view.configured) {
    return (
      <section className="space-y-1">
        <ChannelHeading icon={Mail} title="E-mail" />
        <p className="text-xs text-muted-foreground">E-mail isn&apos;t set up on this server.</p>
      </section>
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setEmail.mutate(value, {
      onSuccess: (r) => {
        setEditing(false);
        toast.success(r.status === "already_confirmed" ? "That address is already confirmed" : `Confirmation link sent to ${value.trim()}`);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const showForm = editing || !view.address;
  return (
    <section className="space-y-2">
      <ChannelHeading
        icon={Mail}
        title="E-mail"
        status={
          view.address && !editing ? (
            view.confirmed ? (
              <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" aria-hidden />
                Confirmed
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-amber-700 dark:text-amber-400">
                Waiting for confirmation
              </Badge>
            )
          ) : null
        }
      />

      {showForm ? (
        <form onSubmit={save} className="space-y-2">
          <label htmlFor="notify-email" className="text-xs text-muted-foreground">
            Address to send to
          </label>
          <div className="flex gap-2">
            <Input
              id="notify-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="you@example.com"
              className="flex-1"
            />
            <Button type="submit" disabled={setEmail.isPending || !value.trim()} className="min-h-9">
              {setEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} className="min-h-9">
                Cancel
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">We&apos;ll send a link to confirm it first.</p>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm break-words">{view.address}</p>
          {!view.confirmed && (
            <p className="text-xs text-muted-foreground">
              Open the link we sent to start getting e-mails. It&apos;s valid for 24 hours.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {view.confirmed ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                disabled={sendTest.isPending}
                onClick={() =>
                  sendTest.mutate("email", {
                    onSuccess: () => toast.success("Test e-mail sent"),
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                {sendTest.isPending && sendTest.variables === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send test"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                disabled={setEmail.isPending}
                onClick={() =>
                  setEmail.mutate(view.address!, {
                    onSuccess: () => toast.success("A new link is on its way"),
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                {setEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send the link again"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9"
              onClick={() => {
                setValue(view.address ?? "");
                setEditing(true);
              }}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 text-destructive"
              disabled={removeEmail.isPending}
              onClick={() =>
                removeEmail.mutate(undefined, {
                  onSuccess: () => toast.success("E-mail removed"),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Telegram ───────────────────────────────────────────────────────────

const TELEGRAM_WAIT_MS = 15 * 60 * 1000;

function TelegramChannel({
  view,
  waiting,
  onWaiting,
}: {
  view: ChannelsView["telegram"];
  waiting: boolean;
  onWaiting: (waiting: boolean) => void;
}) {
  const link = useTelegramLink();
  const unlink = useUnlinkTelegram();
  const sendTest = useSendTest();
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const connected = view.linked && !view.blocked;

  // Linked while we waited (the settings poll saw it): say so, stop waiting.
  useEffect(() => {
    if (!waiting || !connected) return;
    toast.success("Telegram connected");
    onWaiting(false);
  }, [waiting, connected, onWaiting]);

  // The start link lasts 15 minutes; stop waiting with it.
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => onWaiting(false), TELEGRAM_WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting, onWaiting]);

  if (!view.configured) {
    return (
      <section className="space-y-1">
        <ChannelHeading icon={Send} title="Telegram" />
        <p className="text-xs text-muted-foreground">Telegram isn&apos;t set up on this server.</p>
      </section>
    );
  }

  function connect() {
    link.mutate(undefined, {
      onSuccess: ({ url }) => {
        setStartUrl(url);
        onWaiting(true);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <section className="space-y-2">
      <ChannelHeading
        icon={Send}
        title="Telegram"
        status={
          view.linked ? (
            view.blocked ? (
              <Badge variant="secondary" className="text-amber-700 dark:text-amber-400">
                Blocked in Telegram
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" aria-hidden />
                Connected
              </Badge>
            )
          ) : null
        }
      />

      {connected ? (
        <div className="space-y-2">
          <p className="text-sm">{view.username ? `@${view.username}` : "Your Telegram chat"}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={sendTest.isPending}
              onClick={() =>
                sendTest.mutate("telegram", {
                  onSuccess: () => toast.success("Test message sent"),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              {sendTest.isPending && sendTest.variables === "telegram" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send test"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 text-destructive"
              disabled={unlink.isPending}
              onClick={() =>
                unlink.mutate(undefined, {
                  onSuccess: () => toast.success("Telegram disconnected"),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : startUrl && waiting ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Open the bot and press <strong>Start</strong>. This page updates by itself; the link works for 15 minutes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={startUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              <Send className="h-4 w-4" aria-hidden />
              Open Telegram
            </a>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Waiting for Start…
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {view.blocked
              ? "The bot is blocked in Telegram, so nothing reaches you there. Unblock it, or connect again."
              : "Get your plans in a chat with the app's bot."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-9" disabled={link.isPending} onClick={connect}>
              {link.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : view.blocked ? "Connect again" : "Connect Telegram"}
            </Button>
            {view.blocked && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 text-destructive"
                disabled={unlink.isPending}
                onClick={() => unlink.mutate(undefined, { onError: (err) => toast.error(err.message) })}
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
