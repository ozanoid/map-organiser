import { TZDate } from "@date-fns/tz";
import { addDays } from "@/lib/plans/dates";
import type { ChannelKind } from "@/lib/notify/types";

/**
 * Phase 3, slice 2: when the scheduler sends a plan's reminders and the
 * weekly summary. Pure — no database, no clock of its own — so the offline
 * checks run every rule; scheduler.ts feeds it and acts on its answer.
 *
 * Reminders are derived from the plans, never queued ahead: a plan moved to
 * another date gets its reminders there, a cancelled one gets none. Each
 * message has one key in `notifications.dedupe_key`, so it is written once.
 */

export type ReminderSlot = "evening" | "morning";

/** A user's choices (`notification_settings`; no row = DEFAULT_SCHEDULE). */
export interface ScheduleSettings {
  reminderChannels: ChannelKind[];
  /** "HH:MM" the evening before the plan; null = none. */
  eveningTime: string | null;
  /** "HH:MM" the morning of the plan; null = none. */
  morningTime: string | null;
  weeklyChannels: ChannelKind[];
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weeklyDay: number;
  /** "HH:MM"; null = no weekly summary. */
  weeklyTime: string | null;
}

/** Phase 3, decisions 8 and 19 (Ozan, 26.11.2026): on, every connected channel. */
export const DEFAULT_SCHEDULE: ScheduleSettings = {
  reminderChannels: ["email", "telegram"],
  eveningTime: "18:00",
  morningTime: "08:00",
  weeklyChannels: ["email", "telegram"],
  weeklyDay: 1,
  weeklyTime: "08:00",
};

/** A message more than this past its time is skipped ('late'): the
 *  scheduler missed it, and a reminder hours late is noise. */
export const GRACE_MS = 3 * 60 * 60 * 1000;
/** A failed message is tried this many times in all. */
export const MAX_ATTEMPTS = 3;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A zone the runtime knows ("Europe/London"). */
export function isTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The instant a local date and time happen in a zone (clock changes
 *  included: 08:00 London is 07:00 UTC in summer, 08:00 in winter). */
export function atLocal(dateIso: string, hhmm: string, zone: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, h, min, 0, zone).getTime());
}

/** The calendar date an instant falls on in a zone, "YYYY-MM-DD". */
export function localDate(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(dateIso: string): number {
  const d = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The Monday–Sunday week a date falls in, with its ISO week key
 *  ("2026-W49"; 1 January 2027 is in 2026-W53). */
export function weekOf(dateIso: string): { start: string; end: string; key: string } {
  const start = addDays(dateIso, 1 - isoWeekday(dateIso));
  const thursday = addDays(start, 3);
  const year = Number(thursday.slice(0, 4));
  const dayOfYear = (Date.parse(`${thursday}T00:00:00Z`) - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return { start, end: addDays(start, 6), key: `${year}-W${String(week).padStart(2, "0")}` };
}

/** The zone a plan's reminders are timed in: its own (the first stop at a
 *  place with a zone), else the user's, else UTC. */
export function planZone(planTz: string | null, userTz: string | null): string {
  if (isTimeZone(planTz)) return planTz;
  if (isTimeZone(userTz)) return userTz;
  return "UTC";
}

/** A channel the user can be reached on now, with where to send. */
export type ChannelTarget =
  | { channel: "email"; email: string }
  | { channel: "telegram"; chatId: number; username: string | null };

/** An owner with at least one usable channel. */
export interface ScheduleUser {
  userId: string;
  timeZone: string | null;
  settings: ScheduleSettings;
  targets: Partial<Record<ChannelKind, ChannelTarget>>;
}

/** A plan that may have a reminder due: planned, starting around today. */
export interface CandidatePlan {
  id: string;
  userId: string;
  startDate: string;
  /** The zone of its first stop at a place with one, or null. */
  zone: string | null;
  /** The later of when it was made and last changed. */
  changedAt: Date;
}

/** What the outbox already holds for a key. */
export type Existing = Map<string, { status: string; attempts: number }>;

export interface DueMessage {
  kind: "plan_reminder" | "weekly_summary";
  key: string;
  userId: string;
  channel: ChannelKind;
  /** When it was meant to go. */
  at: Date;
  planId?: string;
  slot?: ReminderSlot;
  /** weekly_summary: the seven days it covers, from the day it goes. */
  week?: { start: string; end: string };
}

export interface SkippedMessage {
  kind: "plan_reminder" | "weekly_summary";
  key: string;
  userId: string;
  channel: ChannelKind;
  at: Date;
  planId?: string;
  reason: "late" | "changed";
}

export const reminderKey = (planId: string, startDate: string, slot: ReminderSlot, channel: ChannelKind) =>
  `reminder:${planId}:${startDate}:${slot}:${channel}`;
export const weeklyKey = (userId: string, isoWeek: string, channel: ChannelKind) => `weekly:${userId}:${isoWeek}:${channel}`;

type Verdict = "wait" | "done" | "send" | "late" | "changed";

/**
 * One message's fate now. Recorded as sent or skipped, or failed too often:
 * done. Its time not reached: wait. A plan made or changed after the time
 * (Phase 3, decision 15): changed — it is being looked at, it needs no reminder. More
 * than GRACE_MS past its time: late, unless a try is on record (then left as
 * it is). Otherwise send — the outbox holds a message one sender at a time.
 */
export function verdict(
  at: Date,
  now: Date,
  changedAt: Date | null,
  row: { status: string; attempts: number } | undefined
): Verdict {
  if (row && (row.status === "sent" || row.status === "skipped")) return "done";
  if (row && row.status === "failed" && row.attempts >= MAX_ATTEMPTS) return "done";
  if (now.getTime() < at.getTime()) return "wait";
  if (!row && changedAt && changedAt.getTime() > at.getTime()) return "changed";
  if (now.getTime() - at.getTime() > GRACE_MS) return row ? "done" : "late";
  return "send";
}

/** The window of start dates whose reminders can be due now, in any zone
 *  (UTC−12 … UTC+14) and within the grace period. */
export function candidateWindow(now: Date): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  return { from: addDays(today, -1), to: addDays(today, 2) };
}

/** A message the run may owe: its key, when it was meant to go, and — for
 *  a reminder — when its plan was last made or changed. */
export interface Candidate extends DueMessage {
  changedAt: Date | null;
}

/**
 * Every message the run may owe now: the reminders of the candidate plans and
 * each user's weekly summary, per channel they chose and can be reached on.
 * The outbox rows of these keys are read next, then `dueNow` decides.
 */
export function candidates(now: Date, users: ScheduleUser[], plans: CandidatePlan[]): Candidate[] {
  const out: Candidate[] = [];
  const byUser = new Map(users.map((u) => [u.userId, u]));

  for (const plan of plans) {
    const user = byUser.get(plan.userId);
    if (!user) continue;
    const s = user.settings;
    const zone = planZone(plan.zone, user.timeZone);
    const slots: { slot: ReminderSlot; date: string; time: string | null }[] = [
      { slot: "evening", date: addDays(plan.startDate, -1), time: s.eveningTime },
      { slot: "morning", date: plan.startDate, time: s.morningTime },
    ];
    for (const { slot, date, time } of slots) {
      if (!time || !HHMM.test(time)) continue;
      const at = atLocal(date, time, zone);
      for (const channel of s.reminderChannels) {
        if (!user.targets[channel]) continue;
        out.push({
          kind: "plan_reminder",
          key: reminderKey(plan.id, plan.startDate, slot, channel),
          userId: user.userId,
          channel,
          at,
          planId: plan.id,
          slot,
          changedAt: plan.changedAt,
        });
      }
    }
  }

  for (const user of users) {
    const s = user.settings;
    if (!s.weeklyTime || !HHMM.test(s.weeklyTime)) continue;
    const zone = isTimeZone(user.timeZone) ? user.timeZone : "UTC";
    const thisWeek = weekOf(localDate(now, zone));
    for (const monday of [addDays(thisWeek.start, -7), thisWeek.start]) {
      const day = addDays(monday, s.weeklyDay - 1);
      const at = atLocal(day, s.weeklyTime, zone);
      // Last week's only while it can still go: a summary due late on a
      // Sunday is still owed just after midnight, within the grace period.
      if (monday !== thisWeek.start && now.getTime() - at.getTime() > GRACE_MS) continue;
      const key = weekOf(monday).key;
      for (const channel of s.weeklyChannels) {
        if (!user.targets[channel]) continue;
        out.push({
          kind: "weekly_summary",
          key: weeklyKey(user.userId, key, channel),
          userId: user.userId,
          channel,
          at,
          // The seven days from the day it goes: on a Monday, that week; on
          // a Sunday, the week ahead rather than the one ending.
          week: { start: day, end: addDays(day, 6) },
          changedAt: null,
        });
      }
    }
  }
  return out;
}

/**
 * What to do now with each candidate, given the outbox rows of their keys:
 * `send` goes to the outbox; `skip` is recorded as skipped. A weekly summary
 * with no plan in its days is found out by the scheduler, which holds the
 * plans (Phase 3, decision 16: then nothing is sent).
 */
export function dueNow(
  now: Date,
  cands: Candidate[],
  existing: Existing
): { send: DueMessage[]; skip: SkippedMessage[] } {
  const send: DueMessage[] = [];
  const skip: SkippedMessage[] = [];
  for (const { changedAt, ...m } of cands) {
    const v = verdict(m.at, now, changedAt, existing.get(m.key));
    if (v === "send") send.push(m);
    else if (v === "late" || v === "changed") {
      skip.push({ kind: m.kind, key: m.key, userId: m.userId, channel: m.channel, at: m.at, planId: m.planId, reason: v });
    }
  }
  return { send, skip };
}
