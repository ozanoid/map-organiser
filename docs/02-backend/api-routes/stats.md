---
title: Stats route
type: route-group
domain: backend
version: 1.1.0
last_updated: 16.07.2026
status: stable
sources:
  - src/lib/places/user-stats.ts
  - src/app/api/stats/route.ts
related:
  - "[[_README]]"
  - "[[../schema/places]]"
  - "[[../schema/categories]]"
  - "[[../../03-frontend/hooks/use-stats]]"
---

# Stats route

A single endpoint that fans out into multiple aggregate queries to populate the Settings → Stats dashboard.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/stats` | Compute hero stats + visit-status / category / city / month / rating distributions. |

## Per-route detail

### `GET /api/stats`

> **v1.21.0:** aggregation moved verbatim to `src/lib/places/user-stats.ts` (`computeUserStats(supabase, userId)`) so the assistant's `get_stats` tool shares it. Response shape unchanged.

- **Source:** `src/app/api/stats/route.ts`
- **Auth:** required.
- **DB:** multiple parallel `places` SELECTs (different projections); `categories` SELECT via join.
- **RPC attempt:** `get_visit_status_counts` — **this RPC does not currently exist in the schema.** The route catches the failure and falls back to client-side aggregation (`SELECT visit_status FROM places` then count in JS).
- **Response shape:**

```ts
{
  hero: { total: number, countries: number, cities: number, avgRating: number },
  visitStatus: {
    want_to_go: number,
    booked: number,
    visited: number,
    favorite: number,
    none: number
  },
  byCategory: Array<{ name: string, color: string, count: number }>,
  topCities: Array<{ city: string, count: number }>,             // top 10
  monthlyTrend: Array<{ month: string, count: number }>,         // last 12 months
  ratingDistribution: Array<{ rating: number, count: number }>,  // buckets 1-5
}
```

- **Status:** `200`, `401`, `500`.
- **Notes:**
  - Runs ~6 queries in parallel.
  - `monthlyTrend` is computed client-side after fetching `created_at` from places.
  - `ratingDistribution` rounds floats to nearest integer (1–5).
  - `topCities` capped at 10.
  - **The `get_visit_status_counts` RPC fallback path is the active path.** Worth either (a) creating the RPC for performance, or (b) deleting the call attempt to simplify the code.

## Caching

- **React Query staleTime:** 5 minutes (per the v2 design doc; verify in `src/lib/hooks/use-stats.ts`).
- **Server-side caching:** none. Every request re-runs the queries.

## Open questions

- **Missing RPC.** The route attempts `get_visit_status_counts` and silently falls back. Either implement the RPC (one SQL `GROUP BY` call vs. fetching every row) or remove the dead branch.
- **Aggregation strategy.** All work happens per-request on Vercel Functions. At a few hundred places, this is fine; at 100K, a materialized view + scheduled refresh would scale better.
- **Privacy.** Stats only show the requesting user's data (RLS enforces it). No global stats. Good.
