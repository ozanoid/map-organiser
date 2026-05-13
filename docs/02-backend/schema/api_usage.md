---
title: api_usage
type: table
domain: backend
version: 1.1.0
last_updated: 13.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[profiles]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../04-integrations/google-places]]"
  - "[[../../04-integrations/dataforseo]]"
tags:
  - cost
  - observability
---

# `api_usage`

Per-user, per-SKU API call counters with cost data. Rolled up daily. Drives the Settings → API cost tracker.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`. |
| `sku` | text | no | — | Short SKU identifier, e.g. `google.text_search`, `dataforseo.business_info`. |
| `count` | int | no | `1` | Number of calls for this user/sku/day. |
| `cost_per_1k` | numeric | yes | — | Provider's quoted price per 1000 calls. Used by cost tracker UI to compute spend. |
| `created_at` | date | no | `CURRENT_DATE` | **Day granularity** — not a timestamp. |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `api_usage_pkey` | `id` | btree UNIQUE | Primary key. |
| `api_usage_user_id_sku_created_at_key` | `(user_id, sku, created_at)` | btree UNIQUE | One row per user/sku/day. |
| `idx_api_usage_user_date` | `(user_id, created_at)` | btree | "My usage this month" queries. |

## RLS policies

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own usage | ALL | authenticated | `auth.uid() = user_id` |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | (cascading via auth) |

## RPC: `increment_api_usage`

The counter is bumped via the `increment_api_usage(p_user_id uuid, p_sku text, p_cost numeric)` SECURITY DEFINER function:

```sql
INSERT INTO public.api_usage (user_id, sku, count, cost_per_1k, created_at)
VALUES (p_user_id, p_sku, 1, p_cost, CURRENT_DATE)
ON CONFLICT (user_id, sku, created_at)
DO UPDATE SET count = api_usage.count + 1;
```

The composite UNIQUE constraint makes the UPSERT atomic. App code calls this via `src/lib/google/track-usage.ts#trackUsage` after each billable external call.

## Notes

- **Migration.** `create_api_usage_table` (2026-04-13).
- **Day granularity is deliberate.** Reporting is monthly; row-per-day keeps query plans simple and storage small.
- **SKU naming convention.** SKUs registered in `src/lib/google/track-usage.ts#SKU_CONFIG`:
  - `text_search_pro`, `place_details_pro`, `reviews_enterprise`, `photos` (Google Places)
  - `mapbox_load`, `mapbox_search_session` (Mapbox)
  - `dataforseo_business_info_live`, `dataforseo_reviews` (DataForSEO)
  - (Verify by grepping `trackUsage` callers; expand here when new SKUs appear.)
- **Cost computed in UI, not stored.** The `cost_per_1k` column lets the UI multiply by `count / 1000` for monthly spend; no aggregate is precomputed.
- Consumed by: `GET /api/user/usage` (monthly aggregate), `CostTracker` UI component, every external API helper in `src/lib/google/` and `src/lib/dataforseo/`.

## Open questions

- **Retention.** No purge policy — rows accumulate forever. Probably fine (one row per user/sku/day → ~hundreds per user per year), but worth a `DELETE WHERE created_at < now() - interval '2 years'` if the table gets noisy.
- **Sku registry.** No central enum of valid SKUs. A bad string in `trackUsage` silently creates a new SKU. Worth a TypeScript union (`type ApiUsageSku = 'google.text_search' | 'google.place_details' | ...`) in `src/lib/types` to enforce.
