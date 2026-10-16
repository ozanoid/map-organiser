---
title: useInstagramImport
type: hook
domain: frontend
version: 1.0.0
last_updated: 16.10.2026
status: stable
sources:
  - src/lib/hooks/use-instagram-import.ts
  - src/lib/instagram/types.ts
related:
  - "[[_README]]"
  - "[[use-import-job]]"
  - "[[../components/places]]"
  - "[[../components/map]]"
  - "[[../../02-backend/api-routes/instagram]]"
  - "[[../../05-flows/instagram-import-flow]]"
---

# `useInstagramImport` and `useStartInstagramImport`

Start an Instagram import for a post URL, then watch it. The job lives on the
server (`import_jobs`, `kind = 'instagram'`), so both hooks are thin: one POST, one
poll. Same "read, don't drive" shape as [[use-import-job]].

## Signatures

```ts
function useStartInstagramImport(): UseMutationResult<
  { jobId: string; reused?: boolean },
  Error,
  string /* post URL — any text containing an Instagram post/reel link */
>

function useInstagramImport(
  jobId: string | null
): UseQueryResult<InstagramImportView, Error>
```

`InstagramImportView` (`src/lib/instagram/types.ts`) is the dialog's whole
world: computed `phase`, `error`, `postUrl`, the post summary, and one item view
per venue with status, reason, evidence labels, `searchName` and the place's
coordinates and photo. Shape in [[../../02-backend/api-routes/instagram]].

## Behavior

- **`useStartInstagramImport`** — `POST /api/instagram/import { url }`. Resolves
  with `{ jobId, reused }`; on a non-2xx (or a body without `jobId`) it throws
  `Error(body.error)`, falling back to "Couldn't start the Instagram import". The
  route's messages are written for the user, so callers show `error.message` as
  is. No cache invalidation — there is nothing to invalidate until the job runs.
- **`useInstagramImport(jobId)`** — `GET /api/instagram/import/[jobId]`
  (`cache: "no-store"`), disabled while `jobId` is `null`.
  `refetchInterval` returns **1500 ms** while the last data has no phase or the
  phase is `reading` / `adding`, and `false` once it is `done` / `failed` — a
  finished job holds still. A non-2xx throws "Couldn't load the Instagram import".

## Query key

`["instagram-import", jobId]` — one entry per job. The panel invalidates it after
a **Remove** so the removed item drops out at once.

## Dependencies

- Data source: [[../../02-backend/api-routes/instagram|`/api/instagram/import`]].
- Types: `src/lib/instagram/types.ts` (no server-only imports, shared with the routes).

## Consumers

- `InstagramImportPanel` (`src/components/places/instagram-import-panel.tsx`) —
  starts the job once per URL, renders the view, retries, removes places. See
  [[../components/places#instagramimportpanel]].
- `MapContent` (`src/components/map/map-content.tsx`) — the background watcher:
  after the dialog is closed mid-way it keeps `useInstagramImport(igWatchId)`
  running and toasts once the phase is `done` or `failed`. See
  [[../components/map#mapcontent]].

## Edge cases

- **Reused job.** Sharing the same post again within 10 minutes returns the
  existing job (`reused: true`); the caller treats it like a new one.
- **Places are not this hook's concern.** It does not touch `["places"]`; the
  panel invalidates that key as items reach `added`, and `MapContent` does it when
  a watched job finishes.
- **A job that never loads keeps polling.** With no data there is no phase, so a
  404 (wrong id, or another user's job) is re-tried
  every 1.5 s for as long as the component is mounted; the panel shows
  "Couldn't load this import." meanwhile.
- **Stalled jobs end the poll.** The route turns a job stuck in `reading` for
  3 minutes into `failed` / `stalled`, which stops the interval.
