"use client";

import { useState } from "react";

const DAYS_OF_WEEK = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
] as const;

/**
 * NF-02 — day/hour busyness bars (Google Maps "popular times" style).
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor).
 *
 * Type widened vs the original: DataForSEO can return `null` for a whole
 * day (see RawPopularTimes in dataforseo/api-types.ts) — the old
 * `Record<string, Array<…>>` cast hid that and the widget could crash on
 * `null.filter`. Days without data now just render the empty state.
 */
export function PopularTimesWidget({
  popularTimes,
}: {
  popularTimes: Record<
    string,
    Array<{ hour: number; popular_index: number }> | null | undefined
  >;
}) {
  const [selectedDay, setSelectedDay] = useState(
    DAYS_OF_WEEK[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].key
  );

  const dayData = popularTimes[selectedDay] ?? [];
  // Filter to reasonable hours (6am - midnight)
  const hours = dayData.filter((h) => h.hour >= 6 && h.hour <= 23);
  const maxIndex = Math.max(...hours.map((h) => h.popular_index), 1);

  // Does ANY day have data within the DISPLAYED 6-23h window? (Same
  // filter as the chart — a payload with only 0-5am entries would
  // otherwise render a permanently empty shell.) If not, don't render
  // the section at all — matches the old all-or-nothing behavior.
  const anyData = DAYS_OF_WEEK.some((d) =>
    (popularTimes[d.key] ?? []).some((h) => h.hour >= 6 && h.hour <= 23)
  );
  if (!anyData) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Popular Times</h2>
      {/* Day selector */}
      <div className="flex gap-1">
        {DAYS_OF_WEEK.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setSelectedDay(d.key)}
            className={`px-2 py-1 text-[10px] font-medium rounded-full cursor-pointer transition-colors ${
              selectedDay === d.key
                ? "bg-emerald-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {/* Bar chart */}
      {hours.length > 0 ? (
        <div className="flex items-end gap-[3px] h-20">
          {hours.map((h) => {
            const heightPct = (h.popular_index / maxIndex) * 100;
            const isNow =
              selectedDay ===
                DAYS_OF_WEEK[
                  new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
                ].key && h.hour === new Date().getHours();
            return (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center gap-0.5"
                title={`${h.hour}:00 — ${h.popular_index}% busy`}
              >
                <div
                  className={`w-full rounded-sm transition-all ${
                    isNow ? "bg-emerald-500" : "bg-emerald-200"
                  }`}
                  style={{
                    height: `${Math.max(heightPct, 4)}%`,
                    minHeight: "2px",
                  }}
                />
                {h.hour % 3 === 0 && (
                  <span className="text-[8px] text-muted-foreground">
                    {h.hour}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2">
          No data for this day.
        </p>
      )}
    </section>
  );
}
