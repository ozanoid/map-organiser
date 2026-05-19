---
title: City field backfill (admin region → real city)
type: runbook
domain: ops
version: 1.0.0
last_updated: 19.05.2026
status: stable
related:
  - "[[_README]]"
  - "[[../../04-integrations/google-places]]"
  - "[[../../04-integrations/dataforseo]]"
---

# City field backfill (admin region → real city)

> Records the one-off correction shipped on **19.05.2026**. Re-runnable for similar patterns in other countries (Türkiye districts, Brazil estados, etc.) by changing the WHERE clause and the address-extraction regex.

## Context

Both Google Places (old `extractCountryAndCity` in `src/lib/google/places-api.ts`) and DataForSEO (raw `address_info.city` passthrough in `src/lib/dataforseo/transform.ts`) used to store an administrative region in `places.city` whenever the locality / postal_town field wasn't returned by the upstream provider. For UK addresses this meant 174 / 234 places landed under `city='England'` — the user's NL search "best date restaurants in london" missed 75% of the candidate set because `WHERE city = 'London'` only matched the 56 correctly-stored rows.

The going-forward fix landed in the same PR (PR #41):
- Google path: tiered preference (`locality` → `postal_town` → `sublocality_level_1` → `administrative_area_level_2`), `administrative_area_level_1` reserved for city-states (SG, MC, VA, HK, MO) and last-resort.
- DataForSEO path: `refineCity()` post-process. When the raw value is a known admin region for the country, extract the real city from the address string using the country's postcode anchor.

This runbook documents how the existing data was corrected.

## Preconditions

- Supabase MCP write access OR Studio SQL editor with service role.
- Confirm the address column carries the locality (always true for Google + DataForSEO; the address ends with `<street>, <locality> <postcode>, <country>`).
- Backup taken within 24 h.

## Procedure (UK admin-region case, already executed 19.05.2026)

### 1. Audit

```sql
SELECT city, COUNT(*) AS n
FROM places
WHERE country = 'United Kingdom'
  AND city IN ('England','Scotland','Wales','Northern Ireland')
GROUP BY city;
```

For ozanketenci@gmail.com's data this returned 178 rows (174 England + 0 others), confirmed in the [Phase 6 fiasco diagnosis thread](../../CHANGELOG.md).

### 2. Dry-run regex extraction

```sql
SELECT
  city, COUNT(*) AS n,
  substring(
    address from
    '(?:^|,\s*)([A-Za-z][A-Za-z\s''.-]*?)\s+[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\s*,\s*UK\s*$'
  ) AS new_city
FROM places
WHERE country = 'United Kingdom'
  AND city IN ('England','Scotland','Wales','Northern Ireland')
GROUP BY city, new_city
ORDER BY n DESC;
```

Confirm:
- Every row has a non-null `new_city` (the regex matched).
- The new values look like real cities, not admin regions.

Pre-execution this returned 174/174 extracted, distinct values: London (171), Poole (1), Aylesbury (1), Edgware (1).

### 3. Migrate

Migration `backfill_uk_admin_region_cities` (applied 19.05.2026):

```sql
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS _city_backfill_source TEXT;

WITH candidates AS (
  SELECT id, city AS old_city, address,
    substring(
      address from
      '(?:^|,\s*)([A-Za-z][A-Za-z\s''.-]*?)\s+[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\s*,\s*UK\s*$'
    ) AS new_city
  FROM public.places
  WHERE country = 'United Kingdom'
    AND city IN ('England','Scotland','Wales','Northern Ireland')
)
UPDATE public.places p
SET city = c.new_city,
    _city_backfill_source = format('uk_admin_region:%s→%s', c.old_city, c.new_city)
FROM candidates c
WHERE p.id = c.id
  AND c.new_city IS NOT NULL
  AND length(c.new_city) > 0
  AND c.new_city !~ '^(England|Scotland|Wales|Northern Ireland)$';
```

The `!~` safety clause prevents an admin-region → admin-region rewrite if the regex ever misfires (defense-in-depth; never triggered in practice).

### 4. Verify

```sql
-- Should return 0 rows.
SELECT COUNT(*) FROM places
WHERE country = 'United Kingdom'
  AND city IN ('England','Scotland','Wales','Northern Ireland');

-- Should sum to the rows updated in Step 3.
SELECT COUNT(*) FROM places WHERE _city_backfill_source IS NOT NULL;

-- New UK city distribution
SELECT city, COUNT(*) AS n FROM places
WHERE country = 'United Kingdom'
GROUP BY city ORDER BY n DESC;
```

Production state after 19.05.2026 run:
- `still_england` = 0 ✅
- `backfilled_rows` = 178
- New `city='London'` count: 56 → 231

### 5. Rollback

Each row's prior value is preserved in `_city_backfill_source` (format `uk_admin_region:England→London`).

```sql
UPDATE public.places
SET city = split_part(
      regexp_replace(_city_backfill_source, '^uk_admin_region:', ''),
      '→', 1
    ),
    _city_backfill_source = NULL
WHERE _city_backfill_source LIKE 'uk_admin_region:%';
```

After 30 days clean in production (target: 19.06.2026), the `_city_backfill_source` column can be dropped via:

```sql
ALTER TABLE public.places DROP COLUMN _city_backfill_source;
```

## Related: Türkiye district-as-city

Same family of bug. Some places have `city='Kadıköy'`, `city='Beyoğlu'`, `city='Çankaya'`, `city='Kaş'` instead of the real city (İstanbul, Ankara, etc.). Volume in production at writing: 5 rows (small enough to ignore for the urgent fix). The DataForSEO path is the source — they return the borough as city for Turkish addresses.

**Not in scope for the 19.05.2026 run** because:
- Volume is tiny (5 vs UK's 178).
- The address-extraction pattern is different (`Kadıköy/İstanbul, Türkiye` uses `/` separator, not postcode anchor).
- Going-forward Google fix already addresses it (locality tier wins over admin_area_level_2).

If/when needed, the regex would be:

```sql
substring(address from
  '/([A-Za-zçğıöşüÇĞİÖŞÜ ]+),\s*(Türkiye|Turkey)\s*$')
```

## Audit history

| Date | Country | Pattern | Rows | Notes |
|---|---|---|---|---|
| 19.05.2026 | UK | `city ∈ {England, Scotland, Wales, Northern Ireland}` | 178 | All London (171) + Poole/Aylesbury/Edgware (1 each) recovered. Zero admin-region rows remain. |
