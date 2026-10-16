---
title: api_usage
type: table
domain: backend
version: 1.3.0
last_updated: 16.10.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - src/lib/google/track-usage.ts
  - src/lib/ai/track-usage.ts
related:
  - "[[_README]]"
  - "[[profiles]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../04-integrations/google-places]]"
  - "[[../../04-integrations/dataforseo]]"
  - "[[../../04-integrations/hikerapi]]"
  - "[[../../04-integrations/gemini]]"
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
| `sku` | text | no | — | Short SKU identifier — a key of `SKU_CONFIG` or `AI_SKU_CONFIG`, e.g. `text_search_pro`, `dataforseo_business_info_live`, `ai_place_profile`. No CHECK constraint (verified 16.10.2026). |
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
- **SKU naming convention.** Two registries write this table:
  - `src/lib/google/track-usage.ts#SKU_CONFIG`:
    - `text_search_pro`, `place_details_pro`, `reviews_enterprise`, `photos` (Google Places)
    - `text_search_enterprise` (Google Places, v1.28.0 — the Instagram import's candidate search; its field mask asks for website + phone, which puts Text Search on the Enterprise SKU: $35/1k past 1k free. Billed to the user's own Google key)
    - `mapbox_load`, `mapbox_search_session`, `mapbox_directions` (Mapbox — `mapbox_directions` added v1.22.0, $2/1k past 100k free, tracked at both `getRoute` call sites; `mapbox_load` is registered but has no call site)
    - `dataforseo_business_info_live`, `dataforseo_reviews` (DataForSEO)
    - `hikerapi_request` (HikerAPI, v1.28.0 — every request the Instagram import makes, $1/1k, no free tier)
  - `src/lib/ai/track-usage.ts#AI_SKU_CONFIG` (via `trackAiUsage`, same RPC):
    - `ai_parse_query`, `ai_rank_results`, `ai_place_profile`, `ai_embedding` (placeholder), `ai_compare` (v1.19.0), `ai_chat` (v1.21.0), `ai_trip_plan` (v1.22.0, $12/1k), `ai_instagram_read` (v1.28.0, $1.5/1k — one per Instagram post read; also the unit of the `instagram` budget, 300/month)
  - The Instagram import writes its `hikerapi_request` and `text_search_enterprise` rows in a `finally`, so a failed import's calls are still counted; `ai_instagram_read` is written only when the read succeeded.
  - The cost tracker UI merges both registries (`getMonthlyUsage` spreads `{...SKU_CONFIG, ...AI_SKU_CONFIG}`).
- **Cost computed in UI, not stored.** The `cost_per_1k` column lets the UI multiply by `count / 1000` for monthly spend; no aggregate is precomputed.
- Consumed by: `GET /api/user/usage` (monthly aggregate), `CostTracker` UI component, every external API helper in `src/lib/google/` and `src/lib/dataforseo/`, and `checkAiBudget` (`src/lib/ai/track-usage.ts`) — the monthly AI budget gates read these same per-day counters.

## Open questions

- **Retention.** No purge policy — rows accumulate forever. Probably fine (one row per user/sku/day → ~hundreds per user per year), but worth a `DELETE WHERE created_at < now() - interval '2 years'` if the table gets noisy.
- **Sku registry.** Enforced in TypeScript only: `trackUsage` takes `SkuType = keyof typeof SKU_CONFIG` and `trackAiUsage` takes `AiSku = keyof typeof AI_SKU_CONFIG`, so an unknown SKU does not compile. The table itself accepts any string — there is no CHECK on `sku` — so a new SKU needs no migration, and nothing stops a non-TypeScript writer from inventing one.
