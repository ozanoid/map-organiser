---
title: import-store
type: store
domain: frontend
version: 2.0.0
last_updated: 05.08.2026
status: stable
sources:
  - src/lib/stores/import-store.ts
related:
  - "[[_README]]"
  - "[[../hooks/use-import-job]]"
  - "[[../../02-backend/api-routes/places]]"
  - "[[../../02-backend/schema/import-jobs]]"
  - "[[../../05-flows/place-import-flow]]"
  - "[[../../01-domain/places]]"
---

# `useImportStore`

The single Zustand store. Holds the file the user picked and the options they
chose for it — nothing else. Lives in `src/lib/stores/import-store.ts`.

## What it no longer holds (v2.0.0)

Until 05.08.2026 this store also carried the import's progress: `current`,
`total`, `items`, `cancelled`, `result`, `reviewsEnriching`. That was correct
when the browser drove the import — the page held the parsed place array and
POSTed batches of three, so the store was the only place the run existed.

That is exactly why closing the tab lost the import. The work list now lives in
`import_jobs` / `import_job_items` and progress is read through
[[../hooks/use-import-job]], which puts it in React Query where the repo's rule
says server state belongs. The split is the feature: nothing worth keeping is
held here, so the page can be closed at any moment.

## Shape

```ts
interface ImportState {
  phase: "idle" | "options";

  fileName: string | null;
  fileSize: number;

  visitStatus: VisitStatus | "";
  selectedListIds: string[];
  selectedTagIds: string[];
}
```

`phase` no longer runs a machine — it only answers "has a file been picked yet".
Whether an import is running is a server fact, read from the job.

## Actions

| Action | Signature | Side effects |
|---|---|---|
| `setFile(name, size)` | sets file metadata, `phase` → `"options"` | — |
| `clearFile()` | resets to initial state | — |
| `setVisitStatus(status)` | updates `visitStatus` | — |
| `toggleListId(id)` | adds/removes from `selectedListIds` | — |
| `toggleTagId(id)` | adds/removes from `selectedTagIds` | — |
| `reset()` | full reset | — |

Cancel is not here. It is a `PATCH /api/places/import-jobs/[id]` — the drain
reads job status, not a client flag.

## Persistence

**None**, and now it costs nothing. A page reload loses the file choice, which
the user re-makes in two clicks; the running import is unaffected because the
server owns it. Reopening `/import` shows live progress for a job started in a
tab that no longer exists.

The `File` object itself is held in a `useRef` in the page, not in the store —
it is not serialisable and is only needed until the job is created.

## Consumers

- `src/app/(app)/import/page.tsx` — file picker and options card.

## Edge cases

- **Options are read at create time, not applied later.** `visit_status`,
  `list_ids` and `tag_ids` are copied onto the `import_jobs` row when the job is
  created. Changing them in the store afterwards has no effect on a running job.
- **A file picked but never started** survives navigation within the app, since
  the store is module-scope. It does not survive a reload.
