---
title: RLS Policies
type: overview
domain: backend
version: 1.8.0
last_updated: 25.11.2026
status: stable
sources:
  - pg_policies (via Supabase MCP)
related:
  - "[[_README]]"
  - "[[auth]]"
  - "[[schema/_README]]"
  - "[[../_agent/pitfalls#supabase-supabase-ssr]]"
  - "[[schema/notifications]]"
---

# RLS Policies

Row-Level Security is the access-control spine of this app. Every user-owned table has policies of shape `(auth.uid() = user_id)`. The only public-read carve-out is on `shared_links` (active links only).

Truth source: `pg_policies`, fetched via Supabase MCP `execute_sql`. See per-table docs in [[schema/_README]] for the policy attached to each table; this page is the cross-table view.

## Cross-table policy table

| Table | Policy | Role | CMD | Predicate |
|---|---|---|---|---|
| `api_usage` | Users manage own usage | authenticated | ALL | `auth.uid() = user_id` |
| `assistant_conversations` | Users read own / delete own assistant conversations | authenticated | SELECT, DELETE | `auth.uid() = user_id` — only the server writes (service role; user INSERT dropped 23.11.2026, migration 20261123143607) ([[schema/assistant-conversations]]) |
| `assistant_messages` | Users read own assistant messages | authenticated | SELECT | the conversation is the user's — only the server appends; no UPDATE or DELETE |
| `assistant_tool_runs` | Users read own assistant tool runs | authenticated | SELECT | the conversation is the user's — only the server writes |
| `assistant_spend` | Users read own assistant spend | authenticated | SELECT | `auth.uid() = user_id` — only the service role writes |
| `notification_channels` | Users read own notification channels | authenticated | SELECT | `auth.uid() = user_id` — only the server writes (service role): a user can't mark an address confirmed or point a channel at another chat. Migration 20261125160000, **not applied yet** ([[schema/notifications]]) |
| `notifications` | Users read own notifications | authenticated | SELECT | `auth.uid() = user_id` — only the server writes |
| `channel_link_tokens` | — (RLS on, no policy) | — | — | the server alone reads and writes it |
| `categories` | Users manage own categories | authenticated | ALL | `auth.uid() = user_id` |
| `import_job_items` | `import_job_items_select` | authenticated | SELECT | `auth.uid() = user_id` — read-only by design ([[schema/import-jobs]]) |
| `import_jobs` | `import_jobs_select` / `_insert` / `_update` | authenticated | SELECT, INSERT, UPDATE | `auth.uid() = user_id` |
| `list_places` | Users manage own list_places | authenticated | ALL | USING `list_id IN (SELECT id FROM lists WHERE user_id = auth.uid())`; WITH CHECK also `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` (v1.40.0 — a list could hold another user's place id before) |
| `lists` | Users manage own lists | authenticated | ALL | `auth.uid() = user_id` |
| `place_photos` | Users manage own place_photos | authenticated | ALL | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |
| `place_tags` | Users manage own place_tags | authenticated | ALL | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |
| `places` | Users manage own places | authenticated | ALL | `auth.uid() = user_id` |
| `profiles` | Users can view own profile | authenticated | SELECT | `auth.uid() = id` |
| `profiles` | Users can update own profile | authenticated | UPDATE | `auth.uid() = id` |
| `profiles` | Users can insert own profile | authenticated | INSERT | (with_check) `auth.uid() = id` |
| `saved_filters` | Users manage own saved filters | authenticated | ALL | `auth.uid() = user_id` (v1.20.0 — [[schema/saved_filters]]) |
| `shared_links` | Anyone can read active shared links | public | SELECT | `is_active = true` |
| `shared_links` | Users can manage own shared links | public | ALL | `auth.uid() = user_id` |
| `tags` | Users manage own tags | authenticated | ALL | `auth.uid() = user_id` |
| `trip_day_places` | Users can manage own trip day places | public | ALL | `trip_day_id IN (SELECT td.id FROM trip_days td JOIN trips t ON t.id = td.trip_id WHERE t.user_id = auth.uid())` |
| `trip_days` | Users can manage own trip days | public | ALL | `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())` |
| `trips` | Users can manage own trips | public | ALL | `auth.uid() = user_id` |
| `plans` | Users manage own plans | authenticated | ALL | `auth.uid() = user_id`; WITH CHECK also: `list_id` NULL or an own list |
| `plan_days` | Users manage own plan days | authenticated | ALL | `plan_id IN (SELECT id FROM plans WHERE user_id = auth.uid())` |
| `plan_stops` | Users manage own plan stops | authenticated | ALL | day's plan is the user's; WITH CHECK also: `place_id` NULL or an **own place** |
| `visits` | Users manage own visits | authenticated | ALL | `auth.uid() = user_id`; WITH CHECK also: own place, and `plan_stop_id` NULL or a stop of an own plan |
| `vocabulary_aliases` | Aliases are readable by all authenticated | authenticated | SELECT | `true` — global read, no write policy ([[schema/vocabulary]]) |
| `vocabulary_candidates` | Users manage own vocabulary candidates | authenticated | ALL | `auth.uid() = user_id` |
| `vocabulary_concepts` | Vocabulary is readable by all authenticated | authenticated | SELECT | `true` — global read, no write policy ([[schema/vocabulary]]) |
| `vocabulary_migrations` | *(none — RLS on, service role only)* | — | — | — |

### The global-vocabulary carve-out

`vocabulary_concepts` and `vocabulary_aliases` are the **only tables in the app
that are not user-scoped**. One controlled vocabulary serves every account, so
`using (true)` for SELECT is correct rather than a leak — the rows contain no
user data, only concept names and definitions.

The safety property is on the write side: neither table has an INSERT, UPDATE or
DELETE policy at all. With RLS enabled and no policy, `authenticated` cannot
write, so the dictionary is mutable only by the service role — the monthly
refresh job. `vocabulary_migrations` uses the same posture for the audit trail:
RLS on, zero policies.

`vocabulary_candidates` is different in kind. It holds observations tied to a
user's own places, so it keeps the ordinary `auth.uid() = user_id` shape.

### The write-side carve-out on `import_job_items`

Same idea, narrower. `import_jobs` carries the ordinary owner policies — a user
creates their own import and cancels it. `import_job_items` has SELECT only:
its `stage` column *is* the queue state, and letting a session write it would
let a user hand themselves work the drain then executes.

The initial enqueue therefore runs on the service-role client inside
`POST /api/places/import-jobs`, with `user_id` taken from the verified session
rather than the request body. Writing that route on the caller's client instead
fails loudly with `new row violates row-level security policy` — which is how
the omission surfaced during end-to-end testing rather than in production.

`claim_import_items` follows the same posture: `EXECUTE` revoked from `public`,
`anon` and `authenticated`, `search_path` pinned. See [[schema/import-jobs]].

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
plan_days   ─ via plan_id   → plans.user_id                              (18.11.2026)
plan_stops  ─ via day_id    → plan_days.plan_id → plans.user_id          (two-level walk)
```

**Ownership of referenced rows (18.11.2026).** The plan and visit policies also check, in WITH CHECK, that the rows they point at belong to the user (`plan_stops.place_id`, `visits.place_id`, `visits.plan_stop_id`, `plans.list_id`). A foreign key alone accepts any existing id; the public share view reads with the service role, so a foreign place attached to a stop would be exposed. See [[schema/plans]] and [[schema/visits]].

The two-level walk on `trip_day_places` is the most expensive — measurable in EXPLAIN if trips grow large. Worth keeping an index on `trip_days.trip_id` (already in place by FK) and `trips.user_id` (in place via `trips_pkey` + sequential scan; consider a dedicated `idx_trips_user` if performance degrades).

## The "public" role anomaly

Several policies have `roles = {public}` instead of `{authenticated}`. In Supabase, the `public` role is implicit (every connection has it). The actual gate is the predicate — `auth.uid() = user_id` fails for anonymous requests because `auth.uid()` returns NULL.

The functional difference is small but real: a `{public}` policy is the broader of the two role markers; security depends entirely on the predicate. Tables with `{public}` policies:

- `shared_links` (intentional — public read needed)
- `trips`, `trip_days`, `trip_day_places` (likely from older migrations; predicate still gates correctly). No application code uses these tables since v1.37.0; their policies go with them when they are dropped. The plan tables' policies are `TO authenticated`.
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

This grants anonymous SELECT on `shared_links` rows whose `is_active = true`. **Crucially, it does NOT grant access to the underlying lists/plans/places.** Those still require either `auth.uid() = user_id` or service-role bypass.

That's why `GET /api/shared/[slug]` uses `createServiceClient()` — to read the joined data, the request must bypass RLS. See [[../01-domain/sharing]].

## Advisor findings

From `mcp__supabase__get_advisors(type=security)`, run 19.11.2026 (v1.43.0):

| Lint | Level | Object | Decision |
|---|---|---|---|
| `anon_…` / `authenticated_security_definer_function_executable` | WARN | `increment_api_usage(uuid, text, numeric)` | **Real.** Anyone with the public anon key could write usage rows for any user id; the AI budget guard counts those rows, so a user's monthly AI caps could be run out — and the public shared-list payload carried the owner's id until v1.43.0. **Fixed (applied 19.11.2026, after the code went to production):** `supabase/migrations/20261119005449_rpc_least_privilege.sql` — no `anon`; a signed-in caller counts only their own usage (`p_user_id = auth.uid()`, else `42501`); `service_role` and direct sessions unchanged. |
| same lints | WARN | `handle_new_user()`, `create_default_categories()` | Trigger functions nothing calls over RPC (a direct call fails without `NEW`). Same migration revokes `EXECUTE` from `public`, `anon`, `authenticated`. EXECUTE is checked when a trigger is created, not when it fires — checked in a rolled-back transaction. |
| same lints | WARN | `st_estimatedextent(text, text [, text [, bool]])` | PostGIS, owned by `supabase_admin`: the `postgres` role holds no grant option, so it can't revoke. It returns the planner's estimated extent of a geometry column (for `places.location`, a bounding box over everyone's places). Accepted. |
| `rls_disabled_in_public` | ERROR | `public.spatial_ref_sys` | **Real, worse than the lint says:** its owner `supabase_admin` granted `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` to `anon` and `authenticated`, so the public anon key can change or delete the SRID definitions every geography query reads (as `anon`, an UPDATE of srid 4326 changed 1 row in a rolled-back transaction). `postgres` can't revoke those grants or enable RLS (not the owner), but holds `TRIGGER`. **Fixed (applied 19.11.2026):** `supabase/migrations/20261119005346_spatial_ref_sys_read_only.sql` — a trigger refuses writes from `anon` and `authenticated`; reads, PostGIS, the service role and direct sessions unaffected (checked on the live database after applying: anon UPDATE / DELETE and authenticated UPDATE → 42501, SELECT and a geography distance → ok). The lint stays (RLS is still off). `geometry_columns` / `geography_columns` carry the same grants but are views a write can't change. |
| `extension_in_public` | WARN | `postgis` | PostGIS can't be moved with `ALTER EXTENSION … SET SCHEMA`; moving it means dropping and recreating it under `places.location`. Accepted. |
| `rls_enabled_no_policy` | INFO | `public.vocabulary_migrations` | Service-only table: RLS on, no policy = no access for API roles. Intended. |
| `auth_leaked_password_protection` | WARN | (Auth config) | A Supabase dashboard setting (Auth → password security) — Ozan's to switch on. Sign-ups are closed, so it guards only the existing accounts' password changes. |

### The two migrations (both applied 19.11.2026)

- `spatial_ref_sys_read_only` depended on no code.
- `rpc_least_privilege` went in after the v1.43.0 code served production (merge `d87d9aa`); a connector call then still counted its search for the signed-in user. The order mattered: before that code the import queue's review stage counted usage through a session-less cookie client, i.e. as `anon` (it passes the service client now).
- Every other caller passes a signed-in user's client for that same user, the MCP bearer client (`auth.uid()` = the user), or the service client — listed in [[../_agent/pitfalls]] ("A cookie client outside a cookie request").
- Ozan approved both before they ran.

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
