---
title: Monitoring
type: overview
domain: ops
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[_README]]"
  - "[[../04-integrations/supabase]]"
---

# Monitoring

What we can see when something goes wrong. Honest answer: not much. The current setup is **dashboard-only** — no aggregation, no alerting.

## What's available today

| Surface | Where | Useful for |
|---|---|---|
| Vercel logs | Vercel dashboard → Deployments → Logs | Function invocations, errors, response times |
| Supabase logs | Supabase dashboard → Logs Explorer | DB queries, auth events, slow queries |
| Supabase advisors | MCP `get_advisors` or dashboard → Advisors | Schema issues, RLS gaps, performance hints |
| Mapbox dashboard | mapbox.com/account/statistics | Map loads + Directions calls per month |
| DataForSEO dashboard | app.dataforseo.com | Account balance, calls per day |
| Google Cloud Console | console.cloud.google.com | Places API quota + per-user billing (system key) |

## What's NOT available

- **No Sentry / Datadog / Honeycomb.** Errors don't aggregate.
- **No frontend error tracking.** A user can see a broken UI and we won't know.
- **No alerting.** Nothing pings on quota exhaustion, function failures, or DB slowdowns.
- **No uptime monitoring.** No external pinger.
- **No analytics.** No Plausible, PostHog, Vercel Analytics, etc.

## In-app observability

The closest thing we have is the **`api_usage` table**, which counts external API calls per user/SKU/day. See [[../02-backend/schema/api_usage]]. This is for **cost tracking**, not error monitoring.

## How to diagnose common problems

| Symptom | First place to look |
|---|---|
| Pages 500 | Vercel logs → look for the route name + stack trace |
| Auth not sticking | Supabase logs → Auth → check session refresh events; Vercel logs → middleware |
| Slow `GET /api/places` | Supabase logs → Postgres → check the query plan; verify `idx_places_*` indexes are hit |
| Mapbox not loading | Browser console (CORS / token errors); Mapbox dashboard for quota |
| Place enrichment failing | Vercel logs → `/api/places/parse-link` or `/api/places/[id]/enrich`; DataForSEO dashboard for credentials |
| Cost spike | `api_usage` table — `SELECT sku, sum(count) FROM api_usage WHERE created_at >= now() - interval '7 days' GROUP BY sku` |

## Adding monitoring (recommended next steps)

In rough order of return-on-effort:

1. **Sentry** for both browser and server errors. Free tier is enough at this scale.
2. **Vercel Analytics or Plausible** for page-level traffic.
3. **Supabase log drains** to ship logs out to a long-term store (BetterStack, Logtail).
4. **Cron-based health checks** for `/api/shared/<known-slug>` and `/auth/callback`.
5. **Alerting on `api_usage` thresholds** — e.g. notify when DataForSEO daily calls exceed N.

Each would justify a new section here.

## Useful one-liners

For the maintainer when something feels off:

```sql
-- Top SKUs this week
SELECT sku, sum(count) AS calls
FROM api_usage
WHERE created_at >= current_date - 7
GROUP BY sku
ORDER BY calls DESC;
```

```sql
-- Most recently created places (sanity check on imports)
SELECT created_at, name, source, country
FROM places
ORDER BY created_at DESC
LIMIT 20;
```

```sql
-- Active shared links and their view counts
SELECT slug, resource_type, view_count, created_at
FROM shared_links
WHERE is_active = true
ORDER BY view_count DESC;
```

```sql
-- Are any places stuck at (0,0)? (S2 decode failures)
SELECT id, name, address
FROM places
WHERE ST_X(location::geometry) = 0 AND ST_Y(location::geometry) = 0;
```

## Open questions

- **Error budget.** Without metrics, there's no SLO. Even an informal "I want < 5 failed share-target requests per month" gives us something to alert on.
- **Privacy in logs.** Verify Supabase + Vercel logs don't capture PII in URL paths or function bodies.
