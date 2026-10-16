---
title: useInstagramImport
type: hook
domain: frontend
version: 1.1.0
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

# `useInstagramImport`, `useStartInstagramImport` and `usePickInstagramPlace`

Start an Instagram import for a post URL, watch it, and add the place the user
picks for a venue it skipped. The job lives on the server (`import_jobs`,
`kind = 'instagram'`), so the hooks are thin: one POST, one poll, one POST. Same
"read, don't drive" shape as [[use-import-job]].

## Signatures

```ts
function useStartInstagramImport(
  onStarted?: (jobId: string) => void
): UseMutationResult<
  { jobId: string; reused?: boolean },
  Error,
  string /* post URL — any text containing an Instagram post/reel link */
>

function useInstagramImport(
  jobId: string | null,
  opts?: { waitForPhotos?: boolean } // default true
): UseQueryResult<InstagramImportView, Error>

function usePickInstagramPlace(
  jobId: string | null
): UseMutationResult<
  { status: "already_saved" | "pending" },
  Error,
  { itemId: string; placeId: string }
>
```

`InstagramImportView` (`src/lib/instagram/types.ts`) is the dialog's whole
world: computed `phase`, `error`, `postUrl`, the post summary, and one item view
per venue with status, reason, evidence labels, `searchName`, the `options` to
pick from, `near`, `photoPending` and the place's coordinates and photo. Shape in
[[../../02-backend/api-routes/instagram]].

## Behavior

- **`useStartInstagramImport(onStarted)`** — `POST /api/instagram/import { url }`.
  Resolves with `{ jobId, reused }`; on a non-2xx (or a body without `jobId`) it
  throws `Error(body.error)`, falling back to "Couldn't start the Instagram
  import". The route's messages are written for the user, so callers show
  `error.message` as is. `onStarted(jobId)` runs from the mutation's own
  `onSuccess`, not from `mutate()`'s callbacks: TanStack drops those once the
  calling component unmounts, and a job started just before "Continue in
  background" still has to reach the page that watches it. No cache
  invalidation — there is nothing to invalidate until the job runs.
- **`useInstagramImport(jobId, { waitForPhotos })`** —
  `GET /api/instagram/import/[jobId]` (`cache: "no-store"`), disabled while
  `jobId` is `null`. `refetchInterval` returns **1500 ms** while the last data
  has no phase or the phase is `reading` / `adding`. Once it is `done` /
  `failed` it returns **3000 ms** while any item has `photoPending` — the new
  places' photos land a stage after the places — unless `waitForPhotos` is
  `false`, and `false` otherwise: a finished job holds still. The server stops
  calling a photo pending once the item's `updated_at` — stamped when it reached
  the `photo` stage — is 10 minutes old, so the photo polling ends on its own. A
  non-2xx throws "Couldn't load the Instagram import".
- **`usePickInstagramPlace(jobId)`** —
  `POST /api/instagram/import/[jobId]/pick { itemId, placeId }`. Resolves with
  `{ status: "already_saved" }` when the user already had that place (its tag
  and the post link were added) and `{ status: "pending" }` when the item went
  back into the queue. A non-2xx
  throws `Error(body.error)` — "This place can't be picked for that item.",
  "Already picked.", … — falling back to "Couldn't add that place". On success
  it invalidates `["instagram-import", jobId]`, so the picked item shows as
  pending at once.

## Query key

`["instagram-import", jobId]` — one entry per job. The panel invalidates it after
a **Remove** so the removed item drops out at once; `usePickInstagramPlace`
invalidates it after a pick.

## Dependencies

- Data source: [[../../02-backend/api-routes/instagram|`/api/instagram/import`]].
- Types: `src/lib/instagram/types.ts` (no server-only imports, shared with the routes).

## Consumers

- `InstagramImportPanel` (`src/components/places/instagram-import-panel.tsx`) —
  starts the job once per URL (its `onStarted` calls the latest `onJobId`
  through a ref, since it can fire after the panel unmounted), renders the view,
  retries, removes places and picks a place for a skipped venue. See
  [[../components/places#instagramimportpanel]].
- `MapContent` (`src/components/map/map-content.tsx`) — the background watcher:
  after the dialog is closed mid-way, or when a started job's id arrives after
  the dialog closed, it keeps
  `useInstagramImport(igWatchId, { waitForPhotos: false })` running and toasts
  once the phase is `done` or `failed`. See
  [[../components/map#mapcontent]].

## Edge cases

- **Reused job.** Sharing the same post again within 10 minutes returns the
  existing job (`reused: true`); the caller treats it like a new one.
- **Places are not this hook's concern.** None of the three touches
  `["places"]`; the panel invalidates that key as items reach `added`, and
  `MapContent` does it when a watched job finishes.
- **A job that never loads keeps polling.** With no data there is no phase, so a
  404 (wrong id, or another user's job) is re-tried
  every 1.5 s for as long as the component is mounted; the panel shows
  "Couldn't load this import." meanwhile.
- **Stalled jobs end the poll.** The route turns a job stuck in `reading` for
  3 minutes into `failed` / `stalled`, which stops the interval.
- **A pick restarts the fast poll.** The picked item is back at stage `import`,
  so the computed phase is `adding` again and the interval returns to 1.5 s
  until the place has landed.
