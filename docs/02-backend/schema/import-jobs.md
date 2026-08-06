---
title: Import job tables
type: table
domain: backend
version: 1.0.0
last_updated: 05.08.2026
status: stable
sources:
  - src/app/api/places/import-jobs/route.ts
  - src/app/api/places/import-jobs/[id]/route.ts
  - src/app/api/cron/drain-imports/route.ts
  - src/lib/import/process-place.ts
  - src/lib/hooks/use-import-job.ts
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[../rls-policies]]"
  - "[[../../05-flows/place-import-flow]]"
  - "[[../../03-frontend/stores/import-store]]"
tags:
  - import
  - queue
---

# Import jobs — `import_jobs`, `import_job_items`

The durable work list behind bulk import. Two tables and one claim function turn
a Takeout upload into a queue the server drains on its own schedule.

## Why it exists

The import loop used to run in the browser: the page held the parsed place array
and POSTed batches of three. Closing the tab lost everything still queued — about
1 h 36 min of exposure for a 330-place file at a measured 17.4 s per place — and
re-uploading paid DataForSEO again for every place already imported, because the
duplicate check ran after the lookup.

Moving the list into Postgres fixes both. The tab becomes a viewer, and a place
already carrying an id is skipped for free.

## `import_jobs`

One row per upload.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid` → `auth.users` | cascade delete |
| `file_name` | `text` | shown in the UI |
| `total` | `int` | places parsed out of the file |
| `status` | `text` | `running` \| `done` \| `cancelled` |
| `visit_status` | `text` | import-time default applied to every place |
| `list_ids` | `uuid[]` | ditto |
| `tag_ids` | `uuid[]` | ditto |
| `created_at` | `timestamptz` | |
| `finished_at` | `timestamptz` | set when the job closes |

`status` is the cancel switch: `claim_import_items` only reads from `running`
jobs, so flipping the row stops the drain from taking anything new.

## `import_job_items`

One row per place per job. This is the queue.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `job_id` | `uuid` → `import_jobs` | cascade delete |
| `user_id` | `uuid` → `auth.users` | denormalized so the claim scan and RLS never need the join |
| `payload` | `jsonb` | the parsed place: name, address, lat, lng, googleMapsUrl, note |
| `stage` | `text` | active: `import` \| `reviews` \| `profile`. terminal: `done` \| `skipped` \| `failed` |
| `claimed_at` | `timestamptz` | set when a runner takes the item; stale after 10 min |
| `attempts` | `int` | failed tries **at the current stage**; incremented on claim, reset to 0 when the stage moves; caps at 3 |
| `place_id` | `uuid` → `places` | set once the place exists; `on delete set null` |
| `reason` | `text` | why it was skipped or failed |
| `created_at`, `updated_at` | `timestamptz` | |

`stage` doubles as the queue state. There is no separate `status` column because
"pending at stage X" and "at stage X" are the same thing — what distinguishes a
claimed item is `claimed_at`, not another flag.

## `claim_import_items(p_limit int)`

Hands a runner its next slice and returns the claimed rows.

```sql
update import_job_items i
   set claimed_at = now(), attempts = i.attempts + 1
 where i.id in (
   select c.id from import_job_items c
     join import_jobs j on j.id = c.job_id
    where c.stage in ('import','reviews','profile')
      and j.status = 'running'
      and c.attempts < 3
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
    order by array_position(array['import','reviews','profile'], c.stage), c.created_at
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
- **Stage priority** puts every place on the map before any of them get enriched.
  Import is ~17 s per place; reviews poll DataForSEO for up to 110 s.
- **The stale window** returns an item whose runner died, and `attempts` stops a
  poison item from doing that forever. The drain resets `attempts` on every
  successful stage advance, so the cap counts failures at one stage rather than
  total visits — without the reset a healthy item spent its entire budget just
  walking `import → reviews → profile`, and one transient failure anywhere left
  it stranded: never claimable, never terminal, and the job never closing.

`search_path` is pinned and `EXECUTE` is revoked from `public`, `anon` and
`authenticated` — the function writes rows RLS would otherwise hide, so only the
service-role drain may call it.

## Indexes

| Index | On | Why |
|---|---|---|
| `import_job_items_claimable_idx` | `(created_at) where stage in ('import','reviews','profile')` | the claim scan; partial so terminal rows never widen it |
| `import_job_items_job_idx` | `(job_id)` | progress counts |
| `import_jobs_user_idx` | `(user_id, created_at desc)` | "my latest job" |

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

## Related code

- `src/app/api/places/import-jobs/route.ts` — create (POST), progress (GET).
- `src/app/api/places/import-jobs/[id]/route.ts` — cancel (PATCH).
- `src/app/api/cron/drain-imports/route.ts` — the drain; mirrors the worker
  pattern in `cron/refresh-places`.
- `src/lib/import/process-place.ts` — per-place logic shared by any caller.

## Open questions

- **Retention.** Nothing prunes finished jobs. A 330-place import leaves 330 item
  rows behind forever. Harmless at current scale; a monthly delete of jobs closed
  more than 90 days ago would keep it that way.
- **Per-user fairness.** The claim is global. One user's very large import sits
  ahead of a smaller one from another account.
