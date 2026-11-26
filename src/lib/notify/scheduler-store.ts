import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAssistantOwner } from "@/lib/assistant/owner";
import { setTelegramBlocked } from "@/lib/notify/channels";
import type { WeekPlan } from "@/lib/notify/render";
import { isTimeZone, type CandidatePlan, type ChannelTarget, type Existing, type ScheduleUser } from "@/lib/notify/schedule";
import { scheduleFromRow } from "@/lib/notify/schedule-store";
import type { SchedulerStore } from "@/lib/notify/scheduler";
import type { ChannelKind } from "@/lib/notify/types";
import { addDays } from "@/lib/plans/dates";
import { getPlan } from "@/lib/plans/read";
import { MAX_PLAN_DAYS } from "@/lib/plans/schema";

/**
 * The scheduler's data from Supabase, with the service role — the cron has
 * no user session. Every query names the users it is for; only owners
 * (ASSISTANT_OWNER_EMAILS) are scheduled, like every notification route.
 * `npm run check:notify:db` runs each query against the live schema.
 */
export function supabaseSchedulerStore(admin: SupabaseClient): SchedulerStore {
  return {
    async users() {
      const { data, error } = await admin
        .from("notification_channels")
        .select("user_id, kind, email, telegram_chat_id, telegram_username")
        .not("verified_at", "is", null)
        .is("disabled_at", null);
      if (error) throw new Error(error.message);
      const targets = new Map<string, Partial<Record<ChannelKind, ChannelTarget>>>();
      for (const row of (data ?? []) as {
        user_id: string;
        kind: ChannelKind;
        email: string | null;
        telegram_chat_id: number | null;
        telegram_username: string | null;
      }[]) {
        const t = targets.get(row.user_id) ?? {};
        if (row.kind === "email" && row.email) t.email = { channel: "email", email: row.email };
        if (row.kind === "telegram" && row.telegram_chat_id != null) {
          t.telegram = { channel: "telegram", chatId: Number(row.telegram_chat_id), username: row.telegram_username };
        }
        targets.set(row.user_id, t);
      }

      const owners = (
        await Promise.all(
          [...targets.keys()].map(async (id) => {
            const { data: found, error: lookupError } = await admin.auth.admin.getUserById(id);
            if (lookupError) throw new Error(lookupError.message);
            return isAssistantOwner(found.user?.email) ? id : null;
          })
        )
      ).filter((id): id is string => id !== null);
      if (owners.length === 0) return [];

      const [settings, profiles] = await Promise.all([
        admin
          .from("notification_settings")
          .select("user_id, reminder_channels, reminder_evening_time, reminder_morning_time, weekly_channels, weekly_day, weekly_time")
          .in("user_id", owners),
        admin.from("profiles").select("id, time_zone").in("id", owners),
      ]);
      if (settings.error) throw new Error(settings.error.message);
      if (profiles.error) throw new Error(profiles.error.message);
      const settingsBy = new Map((settings.data ?? []).map((r) => [r.user_id as string, r]));
      const zoneBy = new Map((profiles.data ?? []).map((r) => [r.id as string, r.time_zone as string | null]));

      return owners.map(
        (userId): ScheduleUser => ({
          userId,
          timeZone: isTimeZone(zoneBy.get(userId)) ? zoneBy.get(userId)! : null,
          settings: scheduleFromRow(settingsBy.get(userId) ?? null),
          targets: targets.get(userId) ?? {},
        })
      );
    },

    async plans(userIds, from, to) {
      if (userIds.length === 0) return [];
      const { data, error } = await admin
        .from("plans")
        .select(
          "id, user_id, start_date, created_at, updated_at, days:plan_days(day_number, stops:plan_stops(sort_order, place:places(tz:google_data->>tz)))"
        )
        .in("user_id", userIds)
        .eq("status", "planned")
        .gte("start_date", from)
        .lte("start_date", to);
      if (error) throw new Error(error.message);
      type Row = {
        id: string;
        user_id: string;
        start_date: string;
        created_at: string;
        updated_at: string;
        days: { day_number: number; stops: { sort_order: number; place: { tz: string | null } | null }[] | null }[] | null;
      };
      return ((data ?? []) as unknown as Row[]).map((p): CandidatePlan => {
        // Where the plan begins: its first stop, in day and visiting order,
        // at a place with a zone.
        let zone: string | null = null;
        outer: for (const day of [...(p.days ?? [])].sort((a, b) => a.day_number - b.day_number)) {
          for (const stop of [...(day.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
            if (stop.place?.tz) {
              zone = stop.place.tz;
              break outer;
            }
          }
        }
        return {
          id: p.id,
          userId: p.user_id,
          startDate: p.start_date,
          zone,
          changedAt: new Date(Math.max(Date.parse(p.created_at), Date.parse(p.updated_at))),
        };
      });
    },

    async existing(keys) {
      const out: Existing = new Map();
      for (let i = 0; i < keys.length; i += 100) {
        const { data, error } = await admin
          .from("notifications")
          .select("dedupe_key, status, attempts")
          .in("dedupe_key", keys.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as { dedupe_key: string; status: string; attempts: number }[]) {
          out.set(r.dedupe_key, { status: r.status, attempts: r.attempts });
        }
      }
      return out;
    },

    plan: (userId, planId) => getPlan({ supabase: admin, userId }, planId),

    async weekPlans(userId, start, end) {
      // A plan that began up to MAX_PLAN_DAYS before the week may still run in it.
      const { data, error } = await admin
        .from("plans")
        .select("id, name, start_date, days:plan_days(id, stops:plan_stops(id))")
        .eq("user_id", userId)
        .eq("status", "planned")
        .gte("start_date", addDays(start, -(MAX_PLAN_DAYS - 1)))
        .lte("start_date", end)
        .order("start_date");
      if (error) throw new Error(error.message);
      type Row = { id: string; name: string; start_date: string; days: { id: string; stops: { id: string }[] | null }[] | null };
      return ((data ?? []) as unknown as Row[])
        .map((p): WeekPlan => {
          const dayCount = Math.max(1, p.days?.length ?? 1);
          return {
            id: p.id,
            name: p.name,
            startDate: p.start_date,
            endDate: addDays(p.start_date, dayCount - 1),
            dayCount,
            stopCount: (p.days ?? []).reduce((n, d) => n + (d.stops?.length ?? 0), 0),
          };
        })
        .filter((wp) => wp.endDate >= start);
    },

    async skip(s) {
      const { error } = await admin.from("notifications").upsert(
        {
          user_id: s.userId,
          kind: s.kind,
          channel: s.channel,
          plan_id: s.planId ?? null,
          dedupe_key: s.key,
          due_at: s.at.toISOString(),
          status: "skipped",
          skip_reason: s.reason,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true }
      );
      if (error) throw new Error(error.message);
    },

    telegramGone: (chatId) => setTelegramBlocked(admin, chatId, true),
  };
}
