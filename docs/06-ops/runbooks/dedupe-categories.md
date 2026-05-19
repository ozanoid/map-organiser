---
title: Dedupe duplicate categories (per user)
type: runbook
domain: ops
version: 1.0.0
last_updated: 19.05.2026
status: stable
related:
  - "[[_README]]"
  - "[[../../01-domain/users-and-profiles#signup--first-use-flow]]"
  - "[[../../02-backend/schema/categories]]"
---

# Dedupe duplicate categories (per user)

> **Status as of 19.05.2026:** Zero per-user duplicates exist in production. This runbook is **defensive** — written so the procedure is ready the day a real duplicate appears, typically after a regression in `create_default_categories` (e.g. SECURITY DEFINER trigger fires twice on the same `auth.users` row).

## When to run

- A user reports "two of the same category in my filter list"
- The audit query (Step 1 below) returns ≥ 1 row
- Suspected after restoring a backup or replaying signup events

**Do NOT run** if Step 1 returns 0 rows. The Phase 6 NL search has a defensive `expandDuplicateCategories` helper in `src/app/api/ai/parse-query/route.ts` that is a safe no-op when no dupes exist; nothing else in the app cares about category-name collisions.

## Preconditions

- Supabase MCP write access OR Studio SQL editor access with the service role.
- Latest backup taken within the last 24 h (`Supabase Dashboard → Database → Backups`).

## Steps

### 1. Audit

```sql
SELECT
  u.email,
  c.name,
  COUNT(*) AS dupes,
  array_agg(c.id ORDER BY c.created_at) AS ids_oldest_first,
  array_agg(c.created_at ORDER BY c.created_at) AS created_at
FROM categories c
JOIN auth.users u ON u.id = c.user_id
GROUP BY u.email, c.name
HAVING COUNT(*) > 1
ORDER BY dupes DESC, u.email, c.name;
```

If empty: STOP. There's no work to do.

If non-empty: for each row, pick the **canonical** ID. Heuristic in order:
1. The one with the most places (`(SELECT COUNT(*) FROM places p WHERE p.category_id = c.id)`).
2. Tiebreaker: the oldest `created_at`.

### 2. Plan

For each duplicate set `(user_id, name)` with canonical = `C` and non-canonical = `[N1, N2, ...]`:

```sql
-- Per duplicate group, dry-run the impact:
SELECT
  'places' AS pivot, COUNT(*) AS affected
FROM places
WHERE category_id = ANY(ARRAY['N1','N2'])
UNION ALL
SELECT
  'subcategories' AS pivot, COUNT(*)
FROM subcategories
WHERE parent_category_id = ANY(ARRAY['N1','N2']);
```

Verify the numbers look sane (no surprises like 10 000 places under what should be an empty duplicate).

### 3. Migrate

Wrap each user's dedupe in a single transaction. Repeat per `(user_id, name)` group.

```sql
BEGIN;

-- Replace literals before running. C = canonical, N1..Nk = non-canonical.
UPDATE places
SET category_id = 'C'
WHERE category_id IN ('N1','N2');

-- Sub-categories: detach from non-canonical parents.
-- If the user has overlapping sub-cat slugs under the duplicates, prefer
-- canonical's existing ones and delete the orphans.
WITH siblings AS (
  SELECT slug, MAX(id) FILTER (WHERE parent_category_id = 'C') AS keep_id
  FROM subcategories
  WHERE parent_category_id IN ('C','N1','N2')
  GROUP BY slug
),
dupes AS (
  SELECT s.id
  FROM subcategories s
  LEFT JOIN siblings k ON s.slug = k.slug
  WHERE s.parent_category_id IN ('N1','N2')
    AND k.keep_id IS NOT NULL
)
DELETE FROM subcategories WHERE id IN (SELECT id FROM dupes);

UPDATE subcategories
SET parent_category_id = 'C'
WHERE parent_category_id IN ('N1','N2');

-- Finally: drop the non-canonical category rows.
DELETE FROM categories WHERE id IN ('N1','N2');

COMMIT;
```

### 4. Verify

Re-run the Step-1 audit. Should return zero rows now.

Spot-check the affected user's UI:
- Open filters → verify each category appears once.
- Open a place that used to live under a non-canonical ID → verify the category badge still renders.
- For each sub-category that moved, verify it shows under the canonical parent in the cascade.

### 5. Rollback

If audit shows weird state after Step 3 and within the same session:

- The `BEGIN; ... COMMIT;` wrap means partial state can't have leaked. If `COMMIT` ran already and audit is now broken, restore from the backup captured in Preconditions.

## Pivots NOT touched (intentional)

- `place_tags` — references `tags`/`places`, not categories.
- `list_places` — same.
- `place_photos` — same.

If a future schema adds a direct FK to `categories`, update this runbook.

## Trigger hardening (separate task)

This runbook only cleans data. The trigger that may have caused the duplication — `on_profile_created_default_categories` calling `create_default_categories` — is still callable by `anon`/`authenticated` roles via PostgREST RPC per the Supabase advisor. Hardening (`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`) is captured separately in [[_README#candidates-worth-writing-when-needed|lock-down-security-definer-functions]]. Run the dedupe first; the hardening prevents future occurrences.

## Audit history

- **19.05.2026** — Initial audit found zero per-user duplicates across all users. Phase 6 NL filtering originally suspected a duplicate-Restaurant bug on user `ozanketenci@gmail.com` based on a service-role query that didn't filter by `user_id`. The 4 Restaurant IDs that surfaced were across 4 distinct users (`test`, `ozanketenci`, `admin`, `phase2-test`), each with their seeded default. No fix required.
