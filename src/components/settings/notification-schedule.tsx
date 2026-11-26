"use client";

import { useMemo, useState } from "react";
import { AlarmClock, CalendarDays, Check, ChevronsUpDown, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useSaveSchedule, useSetTimeZone } from "@/lib/hooks/use-notifications";
import { DEFAULT_SCHEDULE, type ScheduleSettings } from "@/lib/notify/schedule";
import type { ChannelKind, NotificationSettingsView } from "@/lib/notify/types";

type OpenView = Extract<NotificationSettingsView, { open: true }>;

/** Every quarter hour: the scheduler runs every 15 minutes, so a time
 *  between two runs would arrive at the next one anyway. */
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return { value: `${h}:${m}`, label: `${h}:${m}` };
});
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, i) => ({
  value: String(i + 1),
  label,
}));
const CHANNEL_LABEL: Record<ChannelKind, string> = { email: "E-mail", telegram: "Telegram" };

/** A time the list holds: a saved "18:07" (another client) shows as itself. */
function timeItems(current: string | null) {
  return current && !TIMES.some((t) => t.value === current) ? [...TIMES, { value: current, label: current }].sort((a, b) => a.value.localeCompare(b.value)) : TIMES;
}

/**
 * Settings → Notifications, Phase 3 slice 2: the reminders before a plan,
 * the weekly summary, and the time zone they follow. Every change is saved
 * at once (shown first, put back if the server refuses).
 */
export function NotificationSchedule({ view }: { view: OpenView }) {
  const save = useSaveSchedule();
  const s = view.schedule;
  const reachable: Record<ChannelKind, boolean> = {
    email: view.email.configured && Boolean(view.email.address) && view.email.confirmed,
    telegram: view.telegram.configured && view.telegram.linked && !view.telegram.blocked,
  };
  const anyReachable = reachable.email || reachable.telegram;

  function change(patch: Partial<ScheduleSettings>) {
    save.mutate({ ...s, ...patch }, { onError: (err) => toast.error(`Couldn't save: ${err.message}`) });
  }

  return (
    <div className="space-y-4">
      {!anyReachable && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Connect your e-mail or Telegram above to get reminders and the weekly summary.
        </p>
      )}

      <section aria-labelledby="reminders-title" className="space-y-2">
        <SectionHeading
          id="reminders-title"
          icon={AlarmClock}
          title="Reminders"
          hint="Before each plan: its first day's stops, times and map links. Times are where the plan takes place."
        />
        <TimeRow
          id="reminder-evening"
          label="The evening before"
          time={s.eveningTime}
          fallback={DEFAULT_SCHEDULE.eveningTime!}
          onChange={(eveningTime) => change({ eveningTime })}
        />
        <TimeRow
          id="reminder-morning"
          label="The morning of"
          time={s.morningTime}
          fallback={DEFAULT_SCHEDULE.morningTime!}
          onChange={(morningTime) => change({ morningTime })}
        />
        <ChannelChoice
          legend="Send reminders to"
          value={s.reminderChannels}
          reachable={reachable}
          onChange={(reminderChannels) => change({ reminderChannels })}
        />
      </section>

      <Separator />

      <section aria-labelledby="weekly-title" className="space-y-2">
        <SectionHeading
          id="weekly-title"
          icon={CalendarDays}
          title="Weekly summary"
          hint="Your plans for the seven days ahead, on the day you choose, in your time zone. Nothing is sent when there are none."
        />
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
          <Switch
            aria-label="Send the weekly summary"
            checked={s.weeklyTime !== null}
            onCheckedChange={(on) => change({ weeklyTime: on ? DEFAULT_SCHEDULE.weeklyTime : null })}
          />
          <span className="text-sm">Every</span>
          <Select
            items={WEEKDAYS}
            value={String(s.weeklyDay)}
            onValueChange={(v) => change({ weeklyDay: Number(v) })}
            disabled={s.weeklyTime === null}
          >
            <SelectTrigger className="h-11 w-36" aria-label="Day of the week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* "at" and its time wrap together on a narrow screen. */}
          <span className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">at</span>
            <TimeSelect
              label="Time of the weekly summary"
              value={s.weeklyTime ?? DEFAULT_SCHEDULE.weeklyTime!}
              disabled={s.weeklyTime === null}
              onChange={(weeklyTime) => change({ weeklyTime })}
            />
          </span>
        </div>
        <ChannelChoice
          legend="Send the summary to"
          value={s.weeklyChannels}
          reachable={reachable}
          onChange={(weeklyChannels) => change({ weeklyChannels })}
        />
      </section>

      <Separator />

      <TimeZoneSetting timeZone={view.timeZone} />
    </div>
  );
}

function SectionHeading({ id, icon: Icon, title, hint }: { id: string; icon: typeof AlarmClock; title: string; hint: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 id={id} className="text-sm font-medium">
          {title}
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** A reminder: on or off, and its time. */
function TimeRow({
  id,
  label,
  time,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  time: string | null;
  fallback: string;
  onChange: (time: string | null) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Switch id={id} checked={time !== null} onCheckedChange={(on) => onChange(on ? fallback : null)} />
      <label htmlFor={id} className="flex-1 cursor-pointer text-sm">
        {label}
      </label>
      <TimeSelect label={`Time — ${label.toLowerCase()}`} value={time ?? fallback} disabled={time === null} onChange={onChange} />
    </div>
  );
}

function TimeSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (time: string) => void;
}) {
  const items = timeItems(value);
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v))} disabled={disabled}>
      <SelectTrigger className="h-11 w-24" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Which channels: a channel not connected stays as chosen, greyed out. */
function ChannelChoice({
  legend,
  value,
  reachable,
  onChange,
}: {
  legend: string;
  value: ChannelKind[];
  reachable: Record<ChannelKind, boolean>;
  onChange: (channels: ChannelKind[]) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      {/* The flex row sits inside: a fieldset doesn't lay out its own gap. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="text-xs text-muted-foreground" aria-hidden>
          Send to
        </span>
        {(["email", "telegram"] as const).map((c) => (
          <label
            key={c}
            className={`flex min-h-11 items-center gap-2 text-sm ${reachable[c] ? "cursor-pointer" : "text-muted-foreground"}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={value.includes(c)}
              disabled={!reachable[c]}
              onChange={(e) => onChange(e.target.checked ? [...value.filter((v) => v !== c), c] : value.filter((v) => v !== c))}
            />
            {CHANNEL_LABEL[c]}
            {!reachable[c] && <span className="text-xs">(not connected)</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "GMT+1" for a zone, now. */
function offsetOf(zone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function TimeZoneSetting({ timeZone }: { timeZone: string | null }) {
  const setZone = useSetTimeZone();
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []), []);
  const device = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  function choose(zone: string) {
    setOpen(false);
    if (zone === timeZone) return;
    setZone.mutate(
      { timeZone: zone },
      {
        onSuccess: () => toast.success(`Time zone set to ${zone}`),
        onError: (err) => toast.error(`Couldn't save: ${err.message}`),
      }
    );
  }

  return (
    <section aria-labelledby="time-zone-title" className="space-y-2">
      <SectionHeading
        id="time-zone-title"
        icon={Globe}
        title="Time zone"
        hint="The weekly summary follows it, and so do the reminders of a plan with no place that has one."
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Change the time zone"
          disabled={setZone.isPending}
          className="flex min-h-11 w-full max-w-sm cursor-pointer items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">
            {timeZone ? (
              <>
                {timeZone} <span className="text-muted-foreground">· {offsetOf(timeZone)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Not set yet — UTC is used</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search time zones" />
            <CommandList>
              <CommandEmpty>No time zone found.</CommandEmpty>
              {zones.map((zone) => (
                <CommandItem key={zone} value={zone} onSelect={() => choose(zone)}>
                  <Check className={`h-4 w-4 ${zone === timeZone ? "opacity-100" : "opacity-0"}`} aria-hidden />
                  <span className="flex-1 truncate">{zone}</span>
                  <span className="text-xs text-muted-foreground">{offsetOf(zone)}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {device && device !== timeZone && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          This device is set to {device}.
          <Button variant="outline" size="sm" className="min-h-9" disabled={setZone.isPending} onClick={() => choose(device)}>
            Use it
          </Button>
        </p>
      )}
    </section>
  );
}
