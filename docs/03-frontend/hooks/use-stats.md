---
title: useStats
type: hook
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/hooks/use-stats.ts
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/stats]]"
---

# `useStats`

Single read-only hook for the stats dashboard.

## Signature

```ts
function useStats(): UseQueryResult<StatsData, Error>

interface StatsData {
  hero: {
    total: number;
    countries: number;
    cities: number;
    avgRating: number;
  };
  visitStatus: Record<"want_to_go" | "booked" | "visited" | "favorite" | "none", number>;
  byCategory: Array<{ name: string; color: string; count: number }>;
  topCities: Array<{ city: string; count: number }>;
  monthlyTrend: Array<{ month: string; count: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
}
```

## Behavior

- `GET /api/stats`.
- Query key `["stats"]`.
- **`staleTime: 5 * 60 * 1000` (5 minutes).** Override of the global default. Stats are aggregate-heavy and don't need second-by-second freshness.
- No mutations.

## Consumers

- `src/app/(app)/stats/page.tsx`.

## Edge cases

- **Inconsistency with mutations elsewhere.** Adding a place won't invalidate `["stats"]`. So the dashboard can lag by up to 5 minutes after a change. Acceptable for stats; document if user complaints surface.
- **No skeleton for partial states.** The stats endpoint returns everything in one payload. If one of the sub-aggregations were to slow down independently, the whole hook waits.
