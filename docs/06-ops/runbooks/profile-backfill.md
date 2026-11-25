---
title: AI place_profile backfill (per user)
type: runbook
domain: ops
version: 1.4.1
last_updated: 25.11.2026
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

- The assistant knows little about some older places ("no profile" in its answers) — likely a coverage gap on `place_profile`.
- New user who imported a large Takeout file and didn't get profiles auto-generated (Phase 4 only auto-generates for *new* saves; legacy data needs the backfill).
- After a model upgrade or schema bump if we ever decide to re-profile en masse.

## Preconditions

- `profiles.ai_features_enabled = true` for the target user. Routes 403 otherwise.
- `ANTHROPIC_API_KEY` set on the deployment (v1.51.0; the Gemini key before) — Settings → AI shows the panel only then.
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

| Call | Per-1k cost | Per-place |
|---|---|---|
| The profile — Claude Sonnet 5.5 (v1.51.0), Claude ledger purpose `profile` | ≈ \$32 (measured over the 6.3 rewrite) | ≈ \$0.032 |
| `dataforseo_reviews` | \$7.50 (one task, measured 19.11.2026) | \$0.0075 |

Worst case per place (reviews + profile): ≈ \$0.040 (v1.51.0; ~\$0.011 at Gemini 3 Flash rates before). A user with 300 reviewless places: ≈ \$12. A lone profile costs more than the batch average (≈ \$0.05–0.08: its system prompt is written to the prompt cache). The panel's estimate uses the same figures (`PROFILE_WRITER_AVG_USD`, the DataForSEO reviews SKU); what was really spent shows in the cost tracker.

> **Monthly budget interaction (15.07.2026):** profile calls count against
> the per-user PROFILE budget (`AI_MONTHLY_PROFILE_CAP`, 1000/month) — a
> full backfill of a ~470-place library fits within a single month
> alongside normal usage. Searches have their own separate budget.
>
> **Since v1.51.0:** profiles are written by Claude Sonnet 5.5 (≈ $0.032 a
> profile in a run of many, measured over the 6.3 rewrite) into the Claude ledger, under the platform's
> $100 monthly cap; the PROFILE budget is no longer checked. Rewriting the
> existing profiles with the current writer is `npm run regen:profiles`
> (Phase 2, 6.3): every place with reviews whose profile it didn't write,
> re-runnable, `--dry-run` to count, `--apply-suggestions` to re-run the
> tag / sub-category auto-apply too.
> Before its first write it saves the profiles it is about to replace to
> `scripts/profile-regen/out/backup-<time>.json` (git-ignored) — the
> database keeps no copy of an overwritten profile. Places whose review list
> is empty are left out (no profile can be written from them).
>
> **Run on 24.11.2026** (Ozan: profile only, every account): 889 profiles
> rewritten — every place with a stored review — $28.28 for 893 calls
> (≈ $0.032 each; the first calls of each run ≈ $0.05–0.08 while the prompt
> cache was written), ≈ 12 s a call at four at a time, 97.1% of the 6,965
> evidence quotes found in the reviews (punctuation aside). Four calls failed
> on a malformed tag id, which then threw the whole profile away; ids are now
> checked one by one (`writeProfile`) and the four were rewritten. The backups
> are in `scripts/profile-regen/out/` on Ozan's machine. Until the branch is
> merged, production (main) keeps writing new and refreshed profiles with
> Gemini: run it once more after the merge.

### Rate limiting

- `MAX_PER_REQUEST = 25` places dispatched per POST. Fire-and-forget — the parent request returns once the chunk is queued (sub-second).
- Client auto-iterates: when `has_more = true`, it re-POSTs every 12 s with a 50-iteration safety ceiling.
- Each `step=profile` call is ~15 s with Claude Sonnet 5.5 (14.7 s on average in the 6.2 measurement); `step=reviews` chained to `step=profile` is ~30 s + 15 s.
- No artificial server-side rate limit. Both providers' own limits (Claude's rate limits, DataForSEO concurrency) cap real throughput.

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
| All POSTs return 503 | `ANTHROPIC_API_KEY` missing on env (v1.51.0; the Gemini key before) | Set in Vercel env → redeploy |
| Count plateaus mid-way | Claude rate limit, the monthly Claude cap ($100 — `step=profile` answers 429) OR DataForSEO concurrency cap | Wait and retry; the cap resets on the 1st |
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

## Places that will never become eligible

A place whose reviews fetch comes back empty — DataForSEO finished the task and
Google has none; a failed fetch stamps nothing since v1.45.0 — gets
`google_data.reviews_checked_at` stamped, and the eligibility report counts it under `no_reviews_available`
rather than `has_cid_no_reviews`. Without that, "has a CID and no reviews" stays
true forever and the panel re-offers the place after every import, burning a
DataForSEO call each time for the same empty answer.

A second, short-lived mark keeps a round from sending the same place twice: each
round stamps `google_data.reviews_requested_at` before sending, and the next
rounds skip a place requested in the last 30 minutes
(`REVIEWS_REQUEST_COOLDOWN_MS`, v1.45.1). The panel fires every 12 s and a
reviews fetch takes 15–110 s, so a place in flight used to be sent again (a
billed task each time); and a failed fetch stamps nothing, so without the mark
a failing place would be sent every round.

The stamp expires after 30 days (`REVIEWS_RECHECK_DAYS` in
`src/lib/places/reviews-checked.ts`), so a place that later accumulates reviews
comes back on its own.

Note that a null `user_ratings_total` is NOT a reliable "no reviews" signal — it
means our stored record is incomplete. The British Museum carries a 4.7 rating
with no review count.
