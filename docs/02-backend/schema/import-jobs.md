---
title: Import job tables
type: table
domain: backend
version: 1.1.0
last_updated: 16.10.2026
status: stable
sources:
  - src/app/api/places/import-jobs/route.ts
  - src/app/api/places/import-jobs/[id]/route.ts
  - src/app/api/cron/drain-imports/route.ts
  - src/app/api/instagram/import/route.ts
  - src/app/api/instagram/import/[id]/route.ts
  - src/lib/instagram/import-job.ts
  - src/lib/instagram/types.ts
  - src/lib/import/process-place.ts
  - src/lib/import/kick-drain.ts
  - src/lib/hooks/use-import-job.ts
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[../rls-policies]]"
  - "[[../../05-flows/place-import-flow]]"
  - "[[../../05-flows/instagram-import-flow]]"
  - "[[../api-routes/instagram]]"
  - "[[../../03-frontend/stores/import-store]]"
tags:
  - import
  - queue
---

# Import jobs — `import_jobs`, `import_job_items`

The durable work list behind both imports. Two tables and one claim function turn
a Takeout upload — or, since v1.28.0, the venues of an Instagram post — into a
queue the server drains on its own schedule.

> **Pending migration (16.10.2026).** `kind` and `meta` below, and the
> `instagram` job kind, come from a migration that is written but **not yet
> applied to the live DB**. See [[#pending-migration]].

## Why it exists

The import loop used to run in the browser: the page held the parsed place array
and POSTed batches of three. Closing the tab lost everything still queued — about
1 h 36 min of exposure for a 330-place file at a measured 17.4 s per place — and
re-uploading paid DataForSEO again for every place already imported, because the
duplicate check ran after the lookup.

Moving the list into Postgres fixes both. The tab becomes a viewer, and a place
already carrying an id is skipped for free.

## `import_jobs`

One row per upload (Takeout) or per shared post (Instagram).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid` → `auth.users` | cascade delete |
| `kind` | `text` not null, default `'takeout'`, CHECK `takeout` \| `instagram` | **pending migration.** Decides `places.source` in the drain and which UI reports the job. |
| `file_name` | `text` | Takeout: the file name, shown in the UI. Instagram: the canonical post URL (`https://www.instagram.com/p/<shortcode>/`) — the 10-minute reuse check matches on it. |
| `total` | `int` | Takeout: places parsed out of the file. Instagram: places queued + places already saved, written once the post is read. |
| `status` | `text` | `running` \| `done` \| `cancelled`, plus `reading` for an Instagram job while its post is being read. No CHECK constraint (verified 16.10.2026). |
| `visit_status` | `text` | import-time default applied to every place (Instagram: always `want_to_go`) |
| `list_ids` | `uuid[]` | ditto (Instagram: none) |
| `tag_ids` | `uuid[]` | ditto (Instagram: the user's `instagram` tag) |
| `meta` | `jsonb` not null, default `'{}'` | **pending migration.** Instagram only: `{ phase, shortcode, post?: { owner, ownerFullName, caption (≤ 280 chars), locationName }, error? }` — `InstagramJobMeta` in `src/lib/instagram/types.ts`. |
| `created_at` | `timestamptz` | |
| `finished_at` | `timestamptz` | set when the job closes |

`status` is the cancel switch: `claim_import_items` only reads from `running`
jobs, so flipping the row stops the drain from taking anything new.

### Two kinds of job

| | `takeout` | `instagram` |
|---|---|---|
| Created by | `POST /api/places/import-jobs` | `POST /api/instagram/import` |
| Items written | all at once, in the request | after the response, once the post is read (`after()`) |
| Status path | `running` → `done` / `cancelled` | `reading` → `running` → `done`, or `reading` → `done` when nothing needs importing or the read failed |
| New places get `source` | `import` | `instagram` |
| Reported by | `GET /api/places/import-jobs` (filters `kind = 'takeout'`) | `GET /api/instagram/import/[id]` |

**Why `reading`.** An Instagram job has no items until its post has been read.
Created as `running`, it would be closed at once by the drain's `finalizeJobs`,
which marks every `running` job with no active items `done`. `reading` keeps it
out of both `finalizeJobs` and the claim until `runInstagramImportJob` has written
its items and flipped it to `running`.

**`meta.phase` is written twice, never by the drain.** `reading` at creation;
then `adding` / `done` / `failed` when the read finishes. The dialog's phase is
computed by `GET /api/instagram/import/[id]` from this value plus the items — see
[[../api-routes/instagram]] — so a finished Instagram job still stores `adding`.
`meta.error` is one of `budget_exceeded`, `invalid_url`, `post_unavailable`,
`not_configured`, `service_error` (the dialog's `stalled` is computed, never
stored).

## `import_job_items`

One row per place per job. This is the queue.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `job_id` | `uuid` → `import_jobs` | cascade delete |
| `user_id` | `uuid` → `auth.users` | denormalized so the claim scan and RLS never need the join |
| `payload` | `jsonb` | the parsed place: name, address, lat, lng, googleMapsUrl, note. Instagram items add `instagram` (`InstagramItemInfo`: label, sources, rule, evidence labels, skip code, same-name count, `searchName`); their `googleMapsUrl` is `https://maps.google.com/?cid=<cid>` (or `?q=place_id:<id>`) and `note` the post URL. |
| `stage` | `text` | active: `import` \| `photo` \| `reviews` \| `profile`. terminal: `done` \| `skipped` \| `failed` |
| `claimed_at` | `timestamptz` | set when a runner takes the item; stale after 10 min |
| `attempts` | `int` | failed tries **at the current stage**; incremented on claim, reset to 0 when the stage moves; caps at 3 |
| `place_id` | `uuid` → `places` | set once the place exists; `on delete set null` |
| `reason` | `text` | why it was skipped or failed. Instagram adds `Already exists` rows written at read time (with `place_id`) and the codes `chain_branch_unknown`, `no_evidence`, `ambiguous`, `closed` for venues it could not pin (no `place_id`). |
| `created_at`, `updated_at` | `timestamptz` | |

`stage` doubles as the queue state. There is no separate `status` column because
"pending at stage X" and "at stage X" are the same thing — what distinguishes a
claimed item is `claimed_at`, not another flag.

Instagram items are born either at `import` (a place to create) or already
terminal at `skipped` (already saved, or not pinnable) — the latter never enter
the queue and exist so the dialog can list them.

## `claim_import_items(p_limit int)`

Hands a runner its next slice and returns the claimed rows.

```sql
update import_job_items i
   set claimed_at = now(), attempts = i.attempts + 1, updated_at = now()
 where i.id in (
   select c.id from import_job_items c
     join import_jobs j on j.id = c.job_id
    where c.stage in ('import','photo','reviews','profile')
      and j.status = 'running'
      and c.attempts < 3
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
    order by array_position(array['import','photo','reviews','profile'], c.stage), c.created_at
    limit p_limit
    for update of c skip locked
 ) returning i.*;
```

Three properties matter:

- **`FOR UPDATE SKIP LOCKED`** is what makes overlapping runs safe. The minute
  cron and the kick fired at job creation can both be in flight; they take
  disjoint items instead of racing. Measured: 6 simultaneous runners against a
  10-item pool returned 10 rows, 0 collisions, every `attempts` at 1.
  (A session-level advisory lock would be the usual guard, but Supabase pools
  connections in transaction mode, where such a lock is not reliably held across
  statements.)
- **Stage priority** puts every place on the map before any of them get enriched,
  then gives them a picture before the slow part. Import is ~17 s per place and
  `photo` is a CDN fetch, while `reviews` polls DataForSEO for up to 110 s.
- **The stale window** returns an item whose runner died, and `attempts` stops a
  poison item from doing that forever. The drain resets `attempts` on every
  successful stage advance, so the cap counts failures at one stage rather than
  total visits — without the reset a healthy item spent its entire budget just
  walking `import → reviews → profile`, and one transient failure anywhere left
  it stranded: never claimable, never terminal, and the job never closing.

`search_path` is pinned and `EXECUTE` is revoked from `public`, `anon` and
`authenticated` — the function writes rows RLS would otherwise hide, so only the
service-role drain may call it.

## `release_import_items(p_ids uuid[])`

The other half of the claim. Sets `claimed_at = null` and gives back the attempt
the claim charged, for items a run took but never reached.

Claiming is not attempting. A run routinely claims more than it can finish — the
`reviews` stage polls DataForSEO for 30-110 s per place, so `CONCURRENCY` workers
clear well under `CLAIM_SIZE` inside the soft deadline. Releasing without
restoring the counter charged those items for a try they never got, and three
such releases retired a perfectly healthy place as `failed`. Same posture as the
claim: pinned `search_path`, `EXECUTE` revoked from everyone but the service
role.

## Indexes

| Index | On | Why |
|---|---|---|
| `import_job_items_claimable_idx` | `(created_at) where stage in ('import','photo','reviews','profile')` | the claim scan; partial so terminal rows never widen it |
| `import_job_items_job_idx` | `(job_id)` | progress counts |
| `import_jobs_user_idx` | `(user_id, created_at desc)` | "my latest job" |
| `idx_import_jobs_user_kind_created` | `(user_id, kind, created_at desc)` | **pending migration.** "My latest Takeout job" and the Instagram reuse check, both of which now filter on `kind` |

## RLS

| Table | Policy | Rule |
|---|---|---|
| `import_jobs` | select / insert / update | `auth.uid() = user_id` — owners create and cancel their own jobs |
| `import_job_items` | select only | `auth.uid() = user_id` |

`import_job_items` is unwritable from a session on purpose: stage transitions
belong to the drain. The create route inserts items on the **service-role**
client with `user_id` taken from the verified session, never from the request
body. Building the route on the caller's client instead fails with
`new row violates row-level security policy` — which is how this was caught.
The Instagram import follows the same rule: the job row is inserted on the
session client, its items by the `after()` job on the service-role client.

## Pending migration

Written for the Instagram import (v1.28.0, branch `feat/instagram-import`) and
**NOT yet applied to the live DB** as of 16.10.2026 — verified that day:
`import_jobs` has no `kind` / `meta` column and `places_source_check` does not
allow `instagram`.

```sql
alter table public.places drop constraint places_source_check;
alter table public.places add constraint places_source_check
  check (source = any (array['manual','import','link','mapbox_search','similar','shared','instagram']));
alter table public.import_jobs
  add column kind text not null default 'takeout' check (kind in ('takeout','instagram')),
  add column meta jsonb not null default '{}'::jsonb;
create index if not exists idx_import_jobs_user_kind_created on public.import_jobs (user_id, kind, created_at desc);
```

Existing rows become `kind = 'takeout'` through the default; the Takeout create
route does not set `kind` and relies on it.

**Apply it before the branch's code serves anyone** — a preview deployment
included, since the vault documents a single Supabase project
(`hukppmaevcapvbrvxtph`) behind every environment. Until then:

- `POST /api/instagram/import` → 500: the insert names `kind` and `meta`;
- `GET /api/instagram/import/[id]` → 404: its `kind` filter errors;
- `GET /api/places/import-jobs` → `{ job: null }`: its new `kind = 'takeout'`
  filter errors and the route reads only `data`, so **a running Takeout import
  disappears from `/import`**;
- the drain is safe — it reads job defaults with `select("*")` and treats a
  missing `kind` as `takeout`.

Apply all four statements together: with `kind` but without the wider
`places_source_check`, every Instagram place would fail at the drain's insert.

## Related code

- `src/app/api/places/import-jobs/route.ts` — Takeout create (POST), progress (GET, `kind = 'takeout'` only).
- `src/app/api/places/import-jobs/[id]/route.ts` — cancel (PATCH).
- `src/app/api/instagram/import/route.ts` — Instagram create / reuse; `after()` job.
- `src/app/api/instagram/import/[id]/route.ts` — Instagram progress view.
- `src/lib/instagram/import-job.ts` — `runInstagramImportJob`: writes the items, `meta`, `total`, `status`.
- `src/app/api/cron/drain-imports/route.ts` — the drain; mirrors the worker
  pattern in `cron/refresh-places`. Reads `kind` to set `places.source`.
- `src/lib/import/process-place.ts` — per-place logic shared by any caller.
- `src/lib/import/kick-drain.ts` — the non-awaited kick both create paths fire.

## Open questions

- **Retention.** Nothing prunes finished jobs. A 330-place import leaves 330 item
  rows behind forever. Harmless at current scale; a monthly delete of jobs closed
  more than 90 days ago would keep it that way.
- **Per-user fairness.** The claim is global. One user's very large import sits
  ahead of a smaller one from another account.
