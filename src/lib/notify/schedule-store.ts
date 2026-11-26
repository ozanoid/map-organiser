import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DEFAULT_SCHEDULE, HHMM, isTimeZone, type ScheduleSettings } from "@/lib/notify/schedule";
import { CHANNEL_KINDS, type ChannelKind } from "@/lib/notify/types";

/**
 * A user's reminder and weekly-summary settings (`notification_settings`,
 * Phase 3 slice 2) and their time zone (`profiles.time_zone`). No settings
 * row means DEFAULT_SCHEDULE — the defaults live in the code alone.
 */
interface ScheduleRow {
  reminder_channels: string[];
  reminder_evening_time: string | null;
  reminder_morning_time: string | null;
  weekly_channels: string[];
  weekly_day: number;
  weekly_time: string | null;
}

const COLUMNS = "reminder_channels, reminder_evening_time, reminder_morning_time, weekly_channels, weekly_day, weekly_time";

const channels = (values: string[]): ChannelKind[] =>
  CHANNEL_KINDS.filter((k) => values.includes(k));
/** Postgres sends a time as "18:00:00"; the app speaks "18:00". */
const hhmm = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

export function scheduleFromRow(row: ScheduleRow | null): ScheduleSettings {
  if (!row) return DEFAULT_SCHEDULE;
  return {
    reminderChannels: channels(row.reminder_channels),
    eveningTime: hhmm(row.reminder_evening_time),
    morningTime: hhmm(row.reminder_morning_time),
    weeklyChannels: channels(row.weekly_channels),
    weeklyDay: row.weekly_day,
    weeklyTime: hhmm(row.weekly_time),
  };
}

export async function readSchedule(admin: SupabaseClient, userId: string): Promise<ScheduleSettings> {
  const { data, error } = await admin.from("notification_settings").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return scheduleFromRow((data as ScheduleRow | null) ?? null);
}

const time = z.string().regex(HHMM, "A time like 18:00").nullable();
const channelList = z.array(z.enum(["email", "telegram"])).max(2);

/** PUT /api/notifications/schedule — every setting, as the screen holds them. */
export const scheduleInput = z
  .object({
    reminderChannels: channelList,
    eveningTime: time,
    morningTime: time,
    weeklyChannels: channelList,
    weeklyDay: z.number().int().min(1).max(7),
    weeklyTime: time,
  })
  .strict();

export async function saveSchedule(admin: SupabaseClient, userId: string, s: ScheduleSettings): Promise<ScheduleSettings> {
  const row = {
    user_id: userId,
    reminder_channels: channels(s.reminderChannels),
    reminder_evening_time: s.eveningTime,
    reminder_morning_time: s.morningTime,
    weekly_channels: channels(s.weeklyChannels),
    weekly_day: s.weeklyDay,
    weekly_time: s.weeklyTime,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from("notification_settings")
    .upsert(row, { onConflict: "user_id" })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return scheduleFromRow(data as ScheduleRow);
}

/** The user's time zone, or null when the browser hasn't told it yet. */
export async function readTimeZone(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("profiles").select("time_zone").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const zone = (data as { time_zone: string | null } | null)?.time_zone ?? null;
  return isTimeZone(zone) ? zone : null;
}

/** PUT /api/user/time-zone. `auto`: the browser's own zone, kept only while
 *  none is set — a zone chosen in Settings stays. */
export const timeZoneInput = z
  .object({
    timeZone: z.string().max(64).refine(isTimeZone, "Not a time zone"),
    auto: z.boolean().optional(),
  })
  .strict();
