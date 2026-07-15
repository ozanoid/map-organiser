---
title: AI place_profile backfill (per user)
type: runbook
domain: ops
version: 1.2.0
last_updated: 15.07.2026
status: stable
related:
  - "[[_README]]"
  - "[[../../03-frontend/components/settings#backfillprofilespanel]]"
  - "[[../../05-flows/full-profile-flow]]"
  - "[[../../04-integrations/gemini]]"
  - "[[../../_plans/backfill-grandfather-reenrich]]"
---

# AI place_profile backfill (per user)

User-facing in **Settings → AI → "Generate AI profiles for older places"**. This runbook is the ops mirror — covers the same flow from the server side for when a user hits a problem or someone needs to backfill for a specific account out-of-band.

## When to run

- A user reports "AI search misses my older places" — likely a coverage gap on `place_profile`.
- New user who imported a large Takeout file and didn't get profiles auto-generated (Phase 4 only auto-generates for *new* saves; legacy data needs the backfill).
- After a model upgrade or schema bump if we ever decide to re-profile en masse.

## Preconditions

- `profiles.ai_features_enabled = true` for the target user. Routes 403 otherwise.
- `GOOGLE_GENERATIVE_AI_API_KEY` set on the deployment.
- DataForSEO env credentials set (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`) for the reviews-fetch leg.
- User has at least one place without a `place_profile` AND with either reviews already fetched OR a Google CID available for the reviews fetch.

## How it works

Eligibility split:

| Bucket | Condition | What runs | SKUs hit |
|---|---|---|---|
| `has_profile` | `google_data.place_profile != null` | nothing (skip) | — |
| `has_reviews_no_profile` | reviews already in `google_data.reviews`, no profile | `POST /enrich?step=profile` | `ai_place_profile` |
| `has_cid_no_reviews` | `google_data.cid` set, no reviews, no profile | `POST /enrich?step=reviews` → chains to `step=profile` | `dataforseo_reviews` + `ai_place_profile` |
| `no_cid_no_profile` | no CID and no reviews | nothing (cannot enrich) | — |

### Cost

| SKU | Per-1k cost | Per-place |
|---|---|---|
| `ai_place_profile` | \$1.00 | \$0.001 |
| `dataforseo_reviews` | \$1.00 (approx) | \$0.001 |

Worst case per place (reviews + profile): ~\$0.011 at Gemini 3 Flash rates (15.07.2026). A user with 300 reviewless places: ~\$3.30. Tracked in the cost tracker like any other AI call.

> **Monthly budget interaction (15.07.2026):** profile calls count against
> the per-user PROFILE budget (`AI_MONTHLY_PROFILE_CAP`, 1000/month) — a
> full backfill of a ~470-place library fits within a single month
> alongside normal usage. Searches have their own separate budget.

### Rate limiting

- `MAX_PER_REQUEST = 25` places dispatched per POST. Fire-and-forget — the parent request returns once the chunk is queued (sub-second).
- Client auto-iterates: when `has_more = true`, it re-POSTs every 12 s with a 50-iteration safety ceiling.
- Each `step=profile` synchronous Gemini Flash call is ~5 s; `step=reviews` chained to `step=profile` is ~30 s + 5 s.
- No artificial server-side rate limit. Both providers' own quotas (Gemini RPM, DataForSEO concurrency) cap real throughput.

## Procedure (UI)

1. Sign in as the user (or shadow-impersonate with service-role token).
2. Open `/settings` → AI tab.
3. The **Generate AI profiles for older places** card appears between the master toggle and the moderation queue. It shows the eligibility split + cost estimate.
4. Click **Generate (N)**.
5. Watch the count come down. The Stop button cancels future iterations (in-flight jobs continue).
6. When the panel disappears, all eligible places have profiles.

## Procedure (out-of-band)

When you don't have the user's UI:

```bash
# As the user (cookie-authenticated). For service-role impersonation, swap in a signed cookie.

# 1. Inspect eligibility
curl -s -H "cookie: <user_cookie>" "$APP/api/user/backfill-profiles" | jq

# 2. Kick off one chunk (returns immediately)
curl -s -X POST -H "cookie: <user_cookie>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}' \
  "$APP/api/user/backfill-profiles" | jq

# 3. Poll eligibility
watch -n 5 'curl -s -H "cookie: <user_cookie>" "$APP/api/user/backfill-profiles" | jq ".has_reviews_no_profile + .has_cid_no_reviews"'
```

## Verification

```sql
-- After backfill, eligibility should be 0 (or down to no_cid_no_profile only).
WITH gd AS (
  SELECT
    id,
    (google_data->'place_profile') IS NOT NULL AS has_profile,
    jsonb_array_length(COALESCE(google_data->'reviews','[]'::jsonb)) > 0 AS has_reviews,
    (google_data->>'cid') IS NOT NULL AS has_cid
  FROM places
  WHERE user_id = '<USER_ID>'
)
SELECT
  COUNT(*) FILTER (WHERE has_profile) AS with_profile,
  COUNT(*) FILTER (WHERE NOT has_profile AND has_reviews) AS still_eligible_profile_only,
  COUNT(*) FILTER (WHERE NOT has_profile AND NOT has_reviews AND has_cid) AS still_eligible_reviews_first,
  COUNT(*) FILTER (WHERE NOT has_profile AND NOT has_reviews AND NOT has_cid) AS cannot_enrich
FROM gd;
```

`still_eligible_*` should be 0. `cannot_enrich` is expected for places saved without CID (e.g. manual entries pre-DataForSEO integration).

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| All POSTs return 403 | `ai_features_enabled = false` | Toggle on in Settings → AI |
| All POSTs return 503 | `GOOGLE_GENERATIVE_AI_API_KEY` missing on env | Set in Vercel env → redeploy |
| Count plateaus mid-way | Gemini quota exceeded OR DataForSEO concurrency cap | Wait, retry; quotas reset daily |
| `cannot_enrich` is large | Places saved without Google CID (manual entries, old import) | Out of scope. Defer or surface a UI to fetch CID by name lookup. |
| Some places re-fire even though they have profile | Race — UI eligibility query stale | Idempotent. The POST checks `has_profile` server-side before queuing. |

## Known limitation — grandfather accounts (thin profiles)

Accounts created before the full DataForSEO migration carry places with only
**≤ 5 reviews and no CID** — Google Places API era data (that API caps reviews
at 5 and returns no CID). The backfill *does* profile these places, but from
those 5 stale reviews, so the result is a **thin profile** (weak TLDR / pros /
cons, often empty `theme_insights`). Once profiled they count as `has_profile`,
so the backfill never revisits them.

This is **not fixed — deferred on purpose**: DataForSEO-era data (every new
place) is unaffected, and only ~1–2 legacy accounts are involved. Full
diagnosis (verified DB data) and a 3-change fix plan are captured in
[[../../_plans/backfill-grandfather-reenrich]].

## Rollback

The backfill only adds data (`places.google_data.place_profile`); it never overwrites a non-null profile. To unwind specific profiles:

```sql
UPDATE places
SET google_data = google_data - 'place_profile'
WHERE user_id = '<USER_ID>'
  AND id = ANY(ARRAY[<place_ids>]);
```

To unwind for a whole user (extreme — only if a bad model run produced garbage profiles):

```sql
UPDATE places
SET google_data = google_data - 'place_profile'
WHERE user_id = '<USER_ID>';
```

Re-run the backfill afterward to regenerate.

## Audit history

| Date | User | Eligible | Cost | Notes |
|---|---|---|---|---|
| _(none yet — backfill flow shipped 19.05.2026)_ | — | — | — | — |
