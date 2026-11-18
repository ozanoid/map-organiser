/**
 * Refresh waves: the whole library is refreshed together, on fixed dates.
 *
 * Before this, each place ran on its own 30-day clock, so one place was
 * refreshed on the 2nd and its neighbour on the 22nd and the library never
 * described one moment. Now every opted-in owner's places are re-fetched in
 * the same wave:
 *
 * - business info (hours, open/closed status, rating, review count) in a wave
 *   starting on the 1st and the 15th of each month, 00:00 UTC;
 * - reviews in the wave starting on the 1st.
 *
 * A place is done for a wave once its last successful fetch is at or after
 * the wave start. A place saved or refreshed by hand mid-wave therefore just
 * joins the next wave, which keeps the library in step.
 *
 * Pure and isomorphic: the refresh cron plans with it, the import paths stamp
 * through it, and the assistant tools and the place page read "as of" dates
 * from it.
 */

/** UTC days of the month on which a business-info wave starts. */
export const BIZ_WAVE_DAYS = [1, 15] as const;
/** UTC day of the month on which a reviews wave starts. */
export const REVIEWS_WAVE_DAY = 1;

/** A failed fetch is retried inside the same wave once this much time has passed… */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
/** …up to this many attempts; after that the place waits for the next wave. */
export const MAX_ATTEMPTS_PER_WAVE = 3;

/**
 * DataForSEO list prices, checked on dataforseo.com/pricing on 18.11.2026:
 * business info Live is $0.0054 per profile; reviews in the Priority queue
 * (what fetchReviews posts) are $0.0015 per 10, so a depth-50 fetch is $0.0075.
 */
export const BIZ_REFRESH_COST_USD = 0.0054;
export const REVIEWS_REFRESH_COST_USD = 0.0075;

/**
 * The monthly DataForSEO budget for background refresh is this multiple of
 * what a normal month costs. A regular month never reaches it; a retry storm
 * or a bug stops at half again the expected spend instead of running on.
 */
export const REFRESH_BUDGET_MULTIPLIER = 1.5;
/** Floor so a small library still has room for retries. */
export const REFRESH_BUDGET_FLOOR_USD = 2;

export type RefreshPart = "biz" | "reviews";

export interface WaveAttempt {
  /** Start date (YYYY-MM-DD) of the wave the attempt belongs to. */
  wave: string;
  /** Attempts made in that wave so far. */
  n: number;
  /** ISO time of the latest attempt. */
  at: string;
}

/** The freshness fields a place carries in google_data. */
export interface FreshnessMarkers {
  /** Stamped by extractExtendedData on every successful business-info lookup. */
  enriched_at?: string | null;
  /** Stamped on every reviews fetch that returned reviews. */
  reviews_refreshed_at?: string | null;
  biz_attempt?: WaveAttempt | null;
  reviews_attempt?: WaveAttempt | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Start (00:00 UTC) of the business-info wave that `now` falls in. */
export function bizWaveStart(now: Date): Date {
  const day = [...BIZ_WAVE_DAYS].reverse().find((d) => now.getUTCDate() >= d) ?? BIZ_WAVE_DAYS[0];
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
}

/** Start (00:00 UTC) of the reviews wave that `now` falls in. */
export function reviewsWaveStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), REVIEWS_WAVE_DAY));
}

export function waveStart(part: RefreshPart, now: Date): Date {
  return part === "biz" ? bizWaveStart(now) : reviewsWaveStart(now);
}

/** When the business info was last fetched successfully. */
export function bizAsOf(m: FreshnessMarkers): string | null {
  return m.enriched_at ?? null;
}

/**
 * When the reviews were last fetched successfully. Places saved before
 * `reviews_refreshed_at` existed fetched their reviews straight after their
 * business info, so `enriched_at` stands in for them.
 */
export function reviewsAsOf(m: FreshnessMarkers): string | null {
  return m.reviews_refreshed_at ?? m.enriched_at ?? null;
}

/** Should a part whose last success was `lastOk` be fetched in this wave now? */
export function isDue(
  lastOk: string | null,
  attempt: WaveAttempt | null | undefined,
  wave: Date,
  now: Date
): boolean {
  if (lastOk && Date.parse(lastOk) >= wave.getTime()) return false;
  if (!attempt || attempt.wave !== isoDay(wave)) return true;
  if (attempt.n >= MAX_ATTEMPTS_PER_WAVE) return false;
  return now.getTime() - Date.parse(attempt.at) >= RETRY_AFTER_MS;
}

/** Which parts of a place the current waves still owe. */
export function dueParts(m: FreshnessMarkers, now: Date): { biz: boolean; reviews: boolean } {
  return {
    biz: isDue(bizAsOf(m), m.biz_attempt, bizWaveStart(now), now),
    reviews: isDue(reviewsAsOf(m), m.reviews_attempt, reviewsWaveStart(now), now),
  };
}

/** The attempt marker to stamp before fetching `part`. */
export function nextAttempt(
  prev: WaveAttempt | null | undefined,
  part: RefreshPart,
  now: Date
): WaveAttempt {
  const wave = isoDay(waveStart(part, now));
  return { wave, n: prev?.wave === wave ? prev.n + 1 : 1, at: now.toISOString() };
}

/** DataForSEO cost of fetching the given parts once. */
export function partsCostUsd(parts: { biz: boolean; reviews: boolean }): number {
  return (parts.biz ? BIZ_REFRESH_COST_USD : 0) + (parts.reviews ? REVIEWS_REFRESH_COST_USD : 0);
}

/** DataForSEO cost of a normal month of waves for a library of `places`. */
export function expectedMonthlyRefreshCostUsd(places: number): number {
  return places * (BIZ_WAVE_DAYS.length * BIZ_REFRESH_COST_USD + REVIEWS_REFRESH_COST_USD);
}

/** The monthly DataForSEO budget for background refresh. */
export function monthlyRefreshBudgetUsd(places: number): number {
  return Math.max(
    REFRESH_BUDGET_FLOOR_USD,
    expectedMonthlyRefreshCostUsd(places) * REFRESH_BUDGET_MULTIPLIER
  );
}

/** "15 Nov", or "15 Nov 2025" outside the current year. */
export function formatAsOf(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
  });
}
