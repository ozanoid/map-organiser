import { formatDayDate } from "@/lib/plans/dates";

/** "Sat 14 Nov" this year, "14 Nov 2025" otherwise — for visit dates. */
export function visitDateLabel(isoDate: string, today = new Date()): string {
  if (isoDate.slice(0, 4) === String(today.getFullYear())) return formatDayDate(isoDate);
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
