/**
 * Convert DataForSEO structured timetable to Google-style weekday_text format.
 *
 * DataForSEO: { monday: [{ open: {hour:9, minute:0}, close: {hour:17, minute:0} }], ... }
 * Google:     ["Monday: 9:00 AM – 5:00 PM", ...]
 */

import type { RawWorkTime, RawTimeSlot } from "./api-types";

const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function convertWorkTimeToOpeningHours(
  workTime: RawWorkTime | null
): { weekday_text: string[]; open_now?: boolean } | null {
  if (!workTime?.work_hours?.timetable) return null;

  const timetable = workTime.work_hours.timetable;
  const weekdayText: string[] = [];

  for (const day of DAY_ORDER) {
    const slots = timetable[day];
    const label = DAY_LABELS[day] || day;

    if (!slots || slots.length === 0) {
      weekdayText.push(`${label}: Closed`);
      continue;
    }

    const timeRanges = slots.map((slot: RawTimeSlot) => {
      const openStr = formatTime(slot.open.hour, slot.open.minute);
      const closeStr = formatTime(slot.close.hour, slot.close.minute);
      return `${openStr} \u2013 ${closeStr}`;
    });

    weekdayText.push(`${label}: ${timeRanges.join(", ")}`);
  }

  // Determine open_now from current_status
  let openNow: boolean | undefined;
  if (workTime.current_status === "opened") {
    openNow = true;
  } else if (
    workTime.current_status === "closed" ||
    workTime.current_status === "temporarily_closed" ||
    workTime.current_status === "closed_forever"
  ) {
    openNow = false;
  }

  return { weekday_text: weekdayText, open_now: openNow };
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, "0");
  return `${h}:${m} ${period}`;
}
