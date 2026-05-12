---
title: RLS Policies
type: overview
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - pg_policies (via Supabase MCP)
related:
  - "[[_README]]"
  - "[[auth]]"
  - "[[schema/_README]]"
  - "[[../_agent/pitfalls#supabase-supabase-ssr]]"
---

# RLS Policies

Row-Level Security is the access-control spine of this app. Every user-owned table has policies of shape `(auth.uid() = user_id)`. The only public-read carve-out is on `shared_links` (active links only).

Truth source: `pg_policies`, fetched via Supabase MCP `execute_sql`. See per-table docs in [[schema/_README]] for the policy attached to each table; this page is the cross-table view.

## Cross-table policy table

| Table | Policy | Role | CMD | Predicate |
|---|---|---|---|---|
| `api_usage` | Users manage own usage | authenticated | ALL | `auth.uid() = user_id` |
| `categories` | Users manage own categories | authenticated | ALL | `auth.uid() = user_id` |
| `list_places` | Users manage own list_places | authenticated | ALL | `list_id IN (SELECT id FROM lists WHERE user_id = auth.uid())` |
| `lists` | Users manage own lists | authenticated | ALL | `auth.uid() = user_id` |
| `place_photos` | Users manage own place_photos | authenticated | ALL | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |
| `place_tags` | Users manage own place_tags | authenticated | ALL | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |
| `places` | Users manage own places | authenticated | ALL | `auth.uid() = user_id` |
| `profiles` | Users can view own profile | authenticated | SELECT | `auth.uid() = id` |
| `profiles` | Users can update own profile | authenticated | UPDATE | `auth.uid() = id` |
| `profiles` | Users can insert own profile | authenticated | INSERT | (with_check) `auth.uid() = id` |
| `shared_links` | Anyone can read active shared links | public | SELECT | `is_active = true` |
| `shared_links` | Users can manage own shared links | public | ALL | `auth.uid() = user_id` |
| `tags` | Users manage own tags | authenticated | ALL | `auth.uid() = user_id` |
| `trip_day_places` | Users can manage own trip day places | public | ALL | `trip_day_id IN (SELECT td.id FROM trip_days td JOIN trips t ON t.id = td.trip_id WHERE t.user_id = auth.uid())` |
| `trip_days` | Users can manage own trip days | public | ALL | `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())` |
| `trips` | Users can manage own trips | public | ALL | `auth.uid() = user_id` |

### Storage (`storage.objects`)

| Policy | Role | CMD | Predicate |
|---|---|---|---|
| Users can upload place photos | authenticated | INSERT | `bucket_id = 'place-photos' AND (storage.foldername(name))[1] = auth.uid()::text` |
| Users can view own place photos | authenticated | SELECT | same as upload |
| Users can update own place photos | public | UPDATE | same as upload |
| Users can delete own place photos | authenticated | DELETE | same as upload |

The `place-photos` bucket is **public** (publicly readable via CDN URL) — the SELECT policy controls who can read via the authenticated Storage API, not who can fetch the URL. See [[schema/place_photos]] and [[../06-ops/encryption]] when written.

## Pattern: direct vs indirect ownership

Most user-owned tables have `user_id` and use the direct predicate `auth.uid() = user_id`. Junction or child tables use a subquery to walk up to the owner:

```
place_tags  ─ via place_id  → places.user_id
place_photos ─ via place_id → places.user_id
list_places ─ via list_id   → lists.user_id
trip_days   ─ via trip_id   → trips.user_id
trip_day_places ─ via trip_day_id → trip_days.trip_id → trips.user_id  (two-level walk)
```

The two-level walk on `trip_day_places` is the most expensive — measurable in EXPLAIN if trips grow large. Worth keeping an index on `trip_days.trip_id` (already in place by FK) and `trips.user_id` (in place via `trips_pkey` + sequential scan; consider a dedicated `idx_trips_user` if performance degrades).

## The "public" role anomaly

Several policies have `roles = {public}` instead of `{authenticated}`. In Supabase, the `public` role is implicit (every connection has it). The actual gate is the predicate — `auth.uid() = user_id` fails for anonymous requests because `auth.uid()` returns NULL.

The functional difference is small but real: a `{public}` policy is the broader of the two role markers; security depends entirely on the predicate. Tables with `{public}` policies:

- `shared_links` (intentional — public read needed)
- `trips`, `trip_days`, `trip_day_places` (likely from older migrations; predicate still gates correctly)
- `storage.objects` UPDATE (same)

This is a minor cleanup opportunity, not a vulnerability.

## The shared-links carve-out

The one place RLS is meant to grant public read:

```sql
CREATE POLICY "Anyone can read active shared links"
  ON public.shared_links FOR SELECT
  TO public
  USING (is_active = true);
```

This grants anonymous SELECT on `shared_links` rows whose `is_active = true`. **Crucially, it does NOT grant access to the underlying lists/trips/places.** Those still require either `auth.uid() = user_id` or service-role bypass.

That's why `GET /api/shared/[slug]` uses `createServiceClient()` — to read the joined data, the request must bypass RLS. See [[../01-domain/sharing]].

## Advisor findings

From `mcp__supabase__get_advisors(type=security)`:

| Lint | Level | Object | Note |
|---|---|---|---|
| `rls_disabled_in_public` | ERROR | `public.spatial_ref_sys` | PostGIS reference table. False positive — enabling RLS without policies would break PostGIS queries. Leave as-is. |
| `extension_in_public` | WARN | `postgis` | Recommend moving to `extensions` schema. Low priority. |
| `anon_security_definer_function_executable` | WARN | `handle_new_user()` | Callable via PostgREST RPC by anon. As a trigger function, calling it without `NEW` context fails — practical risk low but worth `REVOKE EXECUTE ... FROM anon, authenticated`. |
| `anon_security_definer_function_executable` | WARN | `create_default_categories()` | Same as above. |
| `anon_security_definer_function_executable` | WARN | `increment_api_usage(uuid, text, numeric)` | Callable RPC. Used legitimately from API code; consider switching to `SECURITY INVOKER` with RLS-aware grants, or REVOKE from anon. |
| `anon_security_definer_function_executable` | WARN | `st_estimatedextent(text, text [, text [, bool]])` | PostGIS internal — false positive. |
| `auth_leaked_password_protection` | WARN | (auth config) | Enable HaveIBeenPwned check in Auth settings. |

### Recommended hardening (not yet applied)

```sql
-- Strip anon/authenticated access from internal trigger functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_categories()    FROM PUBLIC, anon, authenticated;

-- For increment_api_usage, decide: either revoke from anon (still callable from server with service role),
-- or switch to SECURITY INVOKER and grant carefully.
REVOKE EXECUTE ON FUNCTION public.increment_api_usage(uuid, text, numeric) FROM anon;
```

> Do not apply automatically — see [[../_agent/conventions#things-to-ask-before-doing]]. Surface to user before running.

## Testing RLS

There's no automated test suite. To spot-check a policy:

```sql
-- Impersonate the user
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '<user-uuid>';

SELECT count(*) FROM places;
```

For unauthenticated:

```sql
SET LOCAL ROLE anon;
SELECT count(*) FROM places;  -- should return 0
SELECT count(*) FROM shared_links WHERE is_active = true; -- should return public count
```

(`pgtap` extension is available but not currently used. Could automate later.)
