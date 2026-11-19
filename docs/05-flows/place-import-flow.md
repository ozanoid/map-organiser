---
title: Place Import Flow
type: flow
domain: places
version: 2.3.1
last_updated: 19.11.2026
status: stable
sources:
  - src/app/api/places/import-jobs/route.ts
  - src/app/api/places/import-jobs/[id]/route.ts
  - src/app/api/cron/drain-imports/route.ts
  - src/lib/import/process-place.ts
  - src/lib/import/kick-drain.ts
  - src/lib/hooks/use-import-job.ts
  - src/lib/stores/import-store.ts
  - src/app/(app)/import/page.tsx
  - src/lib/google/takeout-parser.ts
  - src/lib/google/parse-maps-url.ts
  - src/lib/dataforseo/business-info.ts
related:
  - "[[../01-domain/places]]"
  - "[[../02-backend/schema/import-jobs]]"
  - "[[instagram-import-flow]]"
  - "[[../03-frontend/stores/import-store]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../04-integrations/dataforseo]]"
  - "[[../06-ops/runbooks/profile-backfill]]"
---

# Place Import Flow

Server-driven bulk import of saved Google Maps places from a Takeout export. The work list lives in the database, so a run survives a closed tab, a sleeping laptop, and a dropped connection.

> **Shared queue (v1.28.0).** The Instagram import feeds the same `import_jobs` / `import_job_items` queue and the same drain — its jobs carry `kind = 'instagram'` and their places get `source = 'instagram'`; when `finalizeJobs` closes such a job it also sets its `meta.phase` to `done`, and a branch picked in the Instagram dialog re-opens it with one more `import` item (v1.28.1). This page's progress (`GET /api/places/import-jobs`) shows Takeout jobs only. See [[instagram-import-flow]]; the `kind` column came with the Instagram migration, applied 16.10.2026 — [[../02-backend/schema/import-jobs#instagram-migration]].
>
> **Claude's adds (v1.41.0).** `add_places` runs the same `importPlace` inside the tool call, then queues an `assistant` job whose items start at `photo` — the drain only enriches those places ([[../02-backend/schema/import-jobs#assistant-jobs]]). Its options: no payload name (Google's title is used), `requireLookup` (no thin row when Google has no record; a failed lookup throws), a lookup `signal`. The drain maps job kind → `source` (`takeout` → `import`, `instagram`, `assistant`).

## Trigger

User goes to `/import`, picks a CSV or GeoJSON file (typically from Google Takeout → Maps → "Saved"), configures options, clicks Start.

## Steps

```
1. Pick file + options
       │  setFile / toggleListId / toggleTagId / setVisitStatus — UI state only
       ▼
2. POST /api/places/import-jobs  (multipart: file + options JSON)
       │  • Parses CSV / GeoJSON server-side
       │  • INSERT import_jobs (1 row, status 'preparing') + import_job_items
       │    (1 row per place), then status → 'running' (v1.41.0: a job born
       │    running could be closed by the drain before its items landed)
       │  • Fires a non-awaited kick at the drain (kickDrain, src/lib/import/kick-drain.ts)
       │  • Returns { jobId, total } and the request is over
       ▼
3. Drain runs — GET /api/cron/drain-imports
       │  Every minute by Vercel Cron, the kick above, and its own
       │  self-chain while claimable work remains.
       │  claim_import_items(24) → FOR UPDATE SKIP LOCKED
       │  2 workers, 240 s soft deadline, 300 s maxDuration
       │
       │  Each visit advances ONE item ONE stage:
       │
       │    import ──► photo ──► reviews ──► profile ──► done
       │       │                     │
       │       ├─► skipped (already exists / no coordinates)
       │       └─► failed  (insert error / 3 failed attempts at import)
       ▼
4. UI polls GET /api/places/import-jobs every 3 s  (newest job with kind = 'takeout')
       │  Counts per stage → progress bar, "waiting to be added",
       │  "on the map, collecting reviews & tags"
       ▼
5. Job auto-closes when no active items remain (status = done)
```

### Stage detail

| Stage | What happens | Next |
|---|---|---|
| `import` | `resolveIdentity` (free) → duplicate pre-check → `fetchBusinessInfoLive` → INSERT places + place_tags, storing `main_image`; the chosen lists through `addPlaceToLists` (`save_list`, at the end of each list — v1.40.0; a list problem is logged, not an import failure). A concurrent add of the same place that wins the insert (`places_user_google_place_id_key`, v1.41.0) makes this one `skipped / Already exists` with that place's id | `photo`, or `skipped`/`failed` |
| `photo` | `ensurePlacePhoto` — CDN fetch of `main_image` → Storage upload. Free unless `main_image` is missing, which costs one business-info lookup | `reviews`, or straight to `done` if the place already has a profile (a repair-only item). A missing photo records a reason and moves on either way |
| `reviews` | `fetchReviews` (depth 50) → `mergeReviews` into `google_data.reviews` | `profile`, or `done` if the place has no CID or no reviews |
| `profile` | `generatePlaceProfile` — the full Gemini pass, which also applies vocabulary concepts as tags | `done` |

Stage priority in the claim is `import` → `photo` → `reviews` → `profile`, not insertion order. Import is ~17 s per place while reviews poll DataForSEO for up to 110 s; interleaving them would leave the map half-empty for the whole run. The claim's `RETURNING` doesn't keep that order, so the drain sorts the claimed items by stage before working them (v1.41.0; measured before: a picked place's import waited 87 s behind reviews claimed in the same run).

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | Takeout file + options | 1 `import_jobs` row + N `import_job_items` rows. No place rows yet, no API spend. |
| 3 `import` | one item payload | a `places` row (+ list/tag links, photo in Storage) |
| 3 `reviews` | a place with `google_data.cid` | reviews merged into `google_data.reviews` |
| 3 `profile` | a place with reviews | `google_data.place_profile` + vocabulary tags |

## The duplicate pre-check

`resolveIdentity` pulls a CID and/or place_id out of the Takeout URL — regex plus, for short links, one free redirect follow. `findExisting` then looks for a place the user already has under either id, **before** `fetchBusinessInfoLive` is called.

This is what makes a resumed import cheap. The old flow checked for duplicates on `google_place_id`, which only exists after DataForSEO has answered, so re-uploading a 330-place file paid for 330 lookups before concluding it had nothing to do.

Both identifiers are stored on insert, including a CID we derived from the URL when DataForSEO does not return one — otherwise the next run has nothing to match against.

Verified against the three URL shapes Takeout emits (`?cid=`, `?q=place_id:ChIJ…`, `!1s0x…:0x…`), plus a negative control.

## Failure modes

- **Parse fails (step 2):** invalid file. UI shows the error, nothing is written.
- **DataForSEO itself failing (v1.45.1)** — down, out of balance, rate-limited (`serviceFailure`): the item is held, not retried at once — its attempt is given back and its claim kept, so it sits out the 10-minute stale window; the run stops and doesn't chain. An outage or an empty balance holds the import (one free probe per item every 10 minutes) and it resumes by itself. Before, three attempts went in a minute and the whole import ended `failed`.
- **Per-place DataForSEO failure (v1.45.0)** — this request is wrong (an invalid field, say): the lookup throws and the item is retried — up to 3 tries at its stage. At import it then retires as `failed` ("Repeated errors"; re-uploading the file retries only those, the rest are skipped as duplicates). Past import the place exists, so the item isn't `failed`: a photo stage that keeps failing moves on to reviews ("Photo kept failing"), a reviews or profile stage ends `done` with "Reviews kept failing" / "Profile kept failing". Until v1.45.0 a failed lookup read as "no record" and the place was inserted as a thin record for good, a failed reviews fetch was stamped "no reviews" for 30 days, and a stage retired as `failed` made the import views show an added place as not added. Never blocks the queue.
- **DataForSEO has no record for the CID:** the `cid:` lookup returns nothing and the place would land with a name and a coordinate and nothing else — no address, no rating, no image, therefore no photo, no reviews, no profile, no tags. `importPlace` retries once by name, bounded by the resolved coordinate, and discards a hit further than 200 m away (a coordinate is a bias, not a filter, and chains put two branches inside one radius). Measured at 2 of 286 on one import.
- **Photo download or upload fails:** its own stage, so it retries like anything else instead of vanishing. `google_data.main_image` keeps the source URL, so the retry is free. Background callers must hand `downloadAndStorePhotoFromUrl` a service-role client — a cookie-scoped one has no `auth.uid()` and the Storage policy rejects the write silently, returning the same `null` a dead image URL would.
- **Duplicate:** `skipped`, reason `Already exists`, at zero API cost.
- **Runner dies mid-item:** the item keeps a stale `claimed_at` and returns to the pool after 10 minutes.
- **Poison item:** `attempts` caps at 3 per stage; then the item retires — `failed` at import, otherwise as above (the place is kept).
- **Overlapping runs:** safe by construction — `FOR UPDATE SKIP LOCKED` hands concurrent runners disjoint items. Measured: 6 simultaneous runners against a 10-item pool returned 10 items, 0 collisions.
- **Backlog pile-up:** the drain exits early when more than 60 items are already claimed and in flight, which bounds DataForSEO spend.
- **Preview deployments:** Vercel Cron fires on production only. The drain self-chains while work remains — guarded on having made progress this run — so a preview import still completes on the kick alone.
- **Cancel:** `PATCH /api/places/import-jobs/[id]` sets `status = cancelled`; the claim only reads from `running` jobs, so nothing new is taken. Items already in flight finish their current stage.

## Repairing one thing about an existing place

An `import_job_items` row with `stage = 'photo'` and a `place_id` set is a
standalone repair: the drain fixes that place's photo and stops, because a place
that already carries a `place_profile` was enriched on an earlier pass. Sending
it on to `reviews` would re-fetch reviews it already has, re-run the LLM over
them at real cost, and possibly churn its tags for nothing.

That is how the 23 photo-less Belgian places were repaired without a panel, a
new route, or a second secret — the queue already ran in production with the
right credentials.

## Why the work list moved to the database

The v2 design ran the loop in the browser: `import-parse` returned the place array, and the page POSTed `import-batch` three places at a time. That was a deliberate answer to Vercel's old ~60 s function timeout, and it worked, but the work list only existed in the tab.

Two costs followed. A 330-place file needed the tab open for ~1 h 36 min at a measured 17.4 s per place, and any interruption lost the remainder. Re-uploading then paid full DataForSEO price for everything already imported, because the duplicate check ran after the lookup.

Neither constraint holds now. Vercel's default timeout is 300 s, and `cron/refresh-places` had already proven the durable pattern in this codebase: claim a slice, work until a soft deadline, leave the rest for the next run. This flow reuses it.

`import-parse`, `import-batch` and `bulk-enrich-reviews` were removed in the same change — all three were superseded and had no remaining callers.

## Related code

- `src/app/(app)/import/page.tsx` — the page. Reports on the job; does not drive it.
- `src/lib/hooks/use-import-job.ts` — `useImportJob` / `useCreateImportJob` / `useCancelImportJob`.
- `src/lib/stores/import-store.ts` — file choice and options; see [[../03-frontend/stores/import-store]].
- `src/app/api/places/import-jobs/route.ts` — create (POST) and progress (GET, Takeout jobs only).
- `src/lib/import/kick-drain.ts` — `kickDrain`, the non-awaited nudge; shared with the Instagram import.
- `src/app/api/places/import-jobs/[id]/route.ts` — cancel (PATCH).
- `src/app/api/cron/drain-imports/route.ts` — the drain.
- `src/lib/import/process-place.ts` — `resolveIdentity`, `findExisting`, `importPlace`.
- `src/lib/google/takeout-parser.ts` — `parseTakeoutGeoJson`, `parseTakeoutCsv`.
- `src/lib/google/parse-maps-url.ts` — identity extraction from a Maps URL.

## Open questions

- **Throughput.** `CLAIM_SIZE` 24 × `CONCURRENCY` 2 clears roughly 27 import-stage places per run. A 330-place file therefore lands on the map in ~12 minutes and finishes enrichment over the following hour or two. Raising concurrency is a DataForSEO politeness question, not a code one.
- **Per-user fairness.** The claim is global and ordered by stage then age. One user's 5000-place import would sit ahead of another user's 10-place one. A per-user round-robin matters once there is more than one active importer.
