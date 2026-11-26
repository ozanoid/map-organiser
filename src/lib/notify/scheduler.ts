import "server-only";
import type { Delivery, DeliveryOutcome } from "@/lib/notify/outbox";
import { reminderMessage, weeklyMessage, type WeekPlan } from "@/lib/notify/render";
import {
  candidateWindow,
  candidates,
  dueNow,
  type CandidatePlan,
  type Existing,
  type ScheduleUser,
  type SkippedMessage,
} from "@/lib/notify/schedule";
import type { Message } from "@/lib/notify/types";
import type { Plan } from "@/lib/types";

/**
 * One scheduler run (Phase 3, slice 2; /api/cron/notify every 15 minutes):
 * what is due now — schedule.ts decides — rendered from the data as it is
 * and handed to the outbox, or recorded as skipped. The data comes through
 * SchedulerStore, so the offline checks run it with stand-ins.
 */
export interface SchedulerStore {
  /** Owners with at least one usable channel, their settings and zone. */
  users(): Promise<ScheduleUser[]>;
  /** Their planned plans starting between two dates. */
  plans(userIds: string[], from: string, to: string): Promise<CandidatePlan[]>;
  /** The outbox rows of these keys. */
  existing(keys: string[]): Promise<Existing>;
  /** A plan in full, to render its reminder; null when it is gone. */
  plan(userId: string, planId: string): Promise<Plan | null>;
  /** A user's planned plans with a day in this week. */
  weekPlans(userId: string, start: string, end: string): Promise<WeekPlan[]>;
  /** Records a message that came due but isn't sent. */
  skip(s: Omit<SkippedMessage, "reason"> & { reason: SkippedMessage["reason"] | "empty" }): Promise<void>;
  /** The bot was blocked in this chat. */
  telegramGone(chatId: number): Promise<void>;
}

export interface RunSummary {
  users: number;
  plans: number;
  sent: number;
  busy: number;
  failed: number;
  skipped: { late: number; changed: number; empty: number };
}

export async function runScheduler(
  store: SchedulerStore,
  deliver: (d: Delivery) => Promise<DeliveryOutcome>,
  now: Date,
  appUrl: string
): Promise<RunSummary> {
  const summary: RunSummary = { users: 0, plans: 0, sent: 0, busy: 0, failed: 0, skipped: { late: 0, changed: 0, empty: 0 } };
  const users = await store.users();
  summary.users = users.length;
  if (users.length === 0) return summary;

  const window = candidateWindow(now);
  const plans = await store.plans(
    users.map((u) => u.userId),
    window.from,
    window.to
  );
  summary.plans = plans.length;

  const cands = candidates(now, users, plans);
  if (cands.length === 0) return summary;
  const { send, skip } = dueNow(now, cands, await store.existing(cands.map((c) => c.key)));

  for (const s of skip) {
    await store.skip(s);
    summary.skipped[s.reason]++;
  }

  const byUser = new Map(users.map((u) => [u.userId, u]));
  const planCache = new Map<string, Promise<Plan | null>>();
  const weekCache = new Map<string, Promise<WeekPlan[]>>();
  const once = <T,>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key)!;
  };

  for (const m of send) {
    const target = byUser.get(m.userId)?.targets[m.channel];
    if (!target) continue;

    let message: Message;
    if (m.kind === "plan_reminder") {
      const plan = await once(planCache, m.planId!, () => store.plan(m.userId, m.planId!));
      // Deleted or cancelled since the candidates were read: nothing to say.
      if (!plan || plan.status !== "planned") continue;
      message = reminderMessage(plan, m.slot!, appUrl);
    } else {
      const week = m.week!;
      const weekPlans = await once(weekCache, `${m.userId}:${week.start}`, () => store.weekPlans(m.userId, week.start, week.end));
      if (weekPlans.length === 0) {
        await store.skip({ kind: m.kind, key: m.key, userId: m.userId, channel: m.channel, at: m.at, reason: "empty" });
        summary.skipped.empty++;
        continue;
      }
      message = weeklyMessage(weekPlans, week, appUrl);
    }

    const outcome = await deliver({
      userId: m.userId,
      kind: m.kind,
      planId: m.planId ?? null,
      dedupeKey: m.key,
      dueAt: m.at,
      message,
      target,
    });
    if (outcome.status === "sent") summary.sent++;
    else if (outcome.status === "busy") summary.busy++;
    else {
      summary.failed++;
      if (outcome.chatGone && target.channel === "telegram") await store.telegramGone(target.chatId);
    }
  }
  return summary;
}
