/**
 * Plan dates. A plan stores one date, `plans.start_date`; everything else is
 * derived here: a day's date is start + (day_number - 1), the end date is the
 * last day's date. `null` in = `null` out (the plan is not scheduled yet).
 *
 * Dates are plain "YYYY-MM-DD" strings and the math is done in UTC, so a
 * date never shifts with the server's or the browser's time zone.
 */

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayDate(startDate: string | null, dayNumber: number): string | null {
  return startDate ? addDays(startDate, dayNumber - 1) : null;
}

export function planEndDate(startDate: string | null, dayCount: number): string | null {
  return startDate ? addDays(startDate, Math.max(dayCount, 1) - 1) : null;
}

/** Today as "YYYY-MM-DD" in the given IANA time zone (default: the runtime's). */
export function todayIso(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Today where something takes place: in its IANA zone, or in UTC when the
 *  zone is missing or isn't one (a place's stored zone comes from a third
 *  party). */
export function todayAt(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      return todayIso(timeZone);
    } catch {
      // RangeError: not an IANA zone name
    }
  }
  return todayIso("UTC");
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekdayName(isoDate: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

/** "Sat 14 Mar" — for day headers. Formatted in UTC so the date shown is the
 *  date stored. */
export function formatDayDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "12 – 14 Mar 2026", "28 Feb – 2 Mar 2026" or "14 Mar 2026". */
export function formatDateRange(start: string, end: string | null): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  const full: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  if (!end || end === start) return fmt(start, full);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const head = sameMonth
    ? fmt(start, { day: "numeric" })
    : sameYear
      ? fmt(start, { day: "numeric", month: "short" })
      : fmt(start, full);
  return `${head} – ${fmt(end, full)}`;
}

/** Where a plan sits in time — how lists group plans. */
export type PlanPhase = "upcoming" | "unscheduled" | "past" | "cancelled";

/** `today` is the viewer's local date ("YYYY-MM-DD"). A plan is upcoming
 *  until its last day is over. */
export function planPhase(
  plan: { status: "planned" | "cancelled"; start_date: string | null; end_date: string | null },
  today: string
): PlanPhase {
  if (plan.status === "cancelled") return "cancelled";
  if (!plan.start_date) return "unscheduled";
  return (plan.end_date ?? plan.start_date) >= today ? "upcoming" : "past";
}
