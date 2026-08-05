---
title: useImportJob
type: hook
domain: frontend
version: 1.0.0
last_updated: 05.08.2026
status: stable
sources:
  - src/lib/hooks/use-import-job.ts
related:
  - "[[_README]]"
  - "[[../stores/import-store]]"
  - "[[../../02-backend/schema/import-jobs]]"
  - "[[../../02-backend/api-routes/places]]"
  - "[[../../05-flows/place-import-flow]]"
---

# `useImportJob` and family

Three exports: read the running import, start one, cancel one.

## Signatures

```ts
function useImportJob(enabled = true): UseQueryResult<ImportJobProgress | null, Error>

function useCreateImportJob(): UseMutationResult<
  { jobId: string; total: number },
  Error,
  { file: File; visitStatus: string | null; listIds: string[]; tagIds: string[] }
>

function useCancelImportJob(): UseMutationResult<void, Error, string /* jobId */>
```

```ts
interface ImportJobProgress {
  id: string;
  file_name: string | null;
  total: number;
  status: "running" | "done" | "cancelled";
  created_at: string;
  finished_at: string | null;
  /** Row count per stage: import | reviews | profile | done | skipped | failed. */
  counts: Record<string, number>;
  /** Reached a terminal stage, whatever the outcome — what the progress bar tracks. */
  settled: number;
  /** Not yet on the map. */
  pending_import: number;
  /** On the map, still collecting reviews or a profile. */
  enriching: number;
  problems: { name: string; reason: string }[];
}
```

## Behaviour

`useImportJob` reads, it does not drive. The import runs in
`/api/cron/drain-imports` regardless of whether anything is watching, so this is
a plain poll — 3 s while `status === "running"`, and off entirely otherwise:

```ts
refetchInterval: (query) => query.state.data?.status === "running" ? 3000 : false
```

It fetches without a job id on purpose. `GET /api/places/import-jobs` returns the
user's newest job, which is what a person who just reopened the page means by
"my import" — and since [[../stores/import-store]] is transient, there is no id
to pass anyway. This is what makes the page recoverable: load `/import` in a
fresh tab and the running job renders immediately.

`useCreateImportJob` posts the file as multipart with the options as a JSON
field. It returns as soon as the rows are queued — no enrichment happens in that
request — then invalidates `["import-job"]` so the poll picks the new job up.

## Query key

`["import-job"]` — singular and unparameterised, because the query is always
"the newest one".

## Consumers

- `src/app/(app)/import/page.tsx`

## Edge cases

- **Places appear before the job finishes.** The page invalidates `["places"]`
  and `["stats"]` as `settled` moves, so the map fills in during the run rather
  than all at once at the end.
- **Cancel is not instant.** It flips the job row; items already claimed finish
  their current stage. The card can therefore show a couple more completions
  after the click.
- **A finished job stays on screen** until the user picks another file. That is
  deliberate — it is the only place the skipped/failed list is shown.
- **No error surface for a stalled drain.** If `CRON_SECRET` is unset the kick
  silently no-ops and the job sits at `pending_import` until the cron fires.
  Locally, where the secret and DataForSEO credentials are usually absent, a job
  will simply never move.
