/**
 * Dynamic "open now" (v1.18.0) — evaluated at RENDER/FILTER time from the
 * stored structured timetable, in the PLACE's OWN timezone.
 *
 * Why this exists: DataForSEO's `current_status` ("opened"/"closed") is a
 * crawl-time snapshot of Google Maps' live indicator — stale within hours
 * at our refresh cadence. The honest version computes from
 * `google_data.work_timetable` + `google_data.tz` on every evaluation.
 *
 * Pure + client-safe: no tz data tables here — the heavy lifting
 * (coordinate → IANA tz) happened once server-side at extraction
 * (tz-lookup in dataforseo/transform.ts); this module only uses Intl.
 *
 * Semantics:
 * - Returns null when timetable or tz is missing/invalid → "unknown".
 *   Callers decide: the filter EXCLUDES unknown; badges render nothing.
 * - A day key that is null/absent = closed that day (matches how Google
 *   renders "Closed" days).
 * - Overnight slots (close <= open, e.g. 18:00→02:00) belong to the day
 *   they START and spill into the next day.
 * - open == close (e.g. 00:00→00:00) = open 24 hours.
 */

export type Timetable = Record<
  string,
  Array<{
    open: { hour: number; minute: number };
    close: { hour: number; minute: number };
  }> | null
>;

export interface OpenStatus {
  open: boolean;
  /** When open: the closing time of the ACTIVE slot (place-local), for
   *  "Open · closes 23:00" badges. Omitted for 24h-open slots. */
  closesAt?: { hour: number; minute: number };
}

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Place-local (weekdayIndex 0=Sunday, minutes since midnight) — or null
 *  when the IANA tz string is invalid. */
function localNow(
  tz: string,
  now: Date
): { dayIdx: number; minutes: number } | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return null; // invalid tz
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday ?? ""
  );
  if (dayIdx === -1 || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { dayIdx, minutes: hour * 60 + minute };
}

const toMin = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

/**
 * Detailed open status — or null when unknown (no timetable / no tz /
 * invalid tz). Use `isOpenNow` when only the boolean matters.
 */
export function openStatus(
  timetable: Timetable | undefined,
  tz: string | undefined,
  now: Date = new Date()
): OpenStatus | null {
  // {} (zero day keys) is "no data", not "closed all week" — a confident
  // "Closed now" from an empty payload would be a lie.
  if (!timetable || Object.keys(timetable).length === 0 || !tz) return null;
  const local = localNow(tz, now);
  if (!local) return null;

  const todayKey = DAY_KEYS[local.dayIdx];
  const yesterdayKey = DAY_KEYS[(local.dayIdx + 6) % 7];
  const t = local.minutes;

  // Today's slots: normal window, the pre-midnight leg of an overnight
  // slot, or a 24h slot (open == close).
  for (const slot of timetable[todayKey] ?? []) {
    const open = toMin(slot.open);
    const close = toMin(slot.close);
    if (open === close) return { open: true }; // 24h
    if (close > open) {
      if (t >= open && t < close) return { open: true, closesAt: slot.close };
    } else {
      // overnight: open today, closes tomorrow
      if (t >= open) return { open: true, closesAt: slot.close };
    }
  }

  // Yesterday's overnight tail (e.g. Fri 18:00→02:00, now Sat 01:30).
  for (const slot of timetable[yesterdayKey] ?? []) {
    const open = toMin(slot.open);
    const close = toMin(slot.close);
    if (close <= open && open !== close && t < close) {
      return { open: true, closesAt: slot.close };
    }
  }

  return { open: false };
}

/** Boolean-only convenience: true/false when computable, null = unknown. */
export function isOpenNow(
  timetable: Timetable | undefined,
  tz: string | undefined,
  now: Date = new Date()
): boolean | null {
  return openStatus(timetable, tz, now)?.open ?? null;
}

/**
 * v1.22.0 (AI-09): is the place open AT ALL on the given calendar date?
 * Day-granular (not point-in-time) — used to precompute per-trip-day
 * open flags for the AI planner. The weekday comes straight from the ISO
 * date (calendar day, tz-independent); {} / missing timetable → null
 * (unknown ≠ closed), a listed-but-empty day → false.
 */
export function isOpenOnDate(
  timetable: Timetable | undefined,
  isoDate: string
): boolean | null {
  if (!timetable || Object.keys(timetable).length === 0) return null;
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const key = DAY_KEYS[d.getUTCDay()];
  const slots = timetable[key];
  return Array.isArray(slots) && slots.length > 0;
}
