---
title: import-store
type: store
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/stores/import-store.ts
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/places]]"
  - "[[../../01-domain/places]]"
---

# `useImportStore`

The single Zustand store. Holds the state of an in-progress batch import. Lives in `src/lib/stores/import-store.ts`.

Why a store? The import is **client-driven and long-running** — files are parsed, then place-batches are fired in a loop. The user can navigate away from `/import` and come back to a running import; module-scope state preserves that across navigation.

## Shape

```ts
interface ImportState {
  // Phase machine: idle → options → importing → done
  phase: "idle" | "options" | "importing" | "done";

  // Uploaded file
  fileName: string | null;
  fileSize: number;

  // Pre-import options
  visitStatus: VisitStatus | "";
  selectedListIds: string[];
  selectedTagIds: string[];

  // Progress
  current: number;
  total: number;
  items: ImportProgressItem[];
  cancelled: boolean;

  // Result
  result: ImportResult | null;
  reviewsEnriching: boolean;
}

interface ImportProgressItem {
  name: string;
  status: "enriched" | "imported" | "skipped";
  reason?: string;
}

interface ImportResult {
  imported: number;
  failed: number;
  enriched: number;
  total: number;
  skipped: { name: string; reason: string }[];
  importedPlaceIds: string[];
}
```

## Actions

| Action | Signature | Side effects |
|---|---|---|
| `setFile(name, size)` | sets file metadata, advances `phase` to `"options"`, clears result | — |
| `clearFile()` | resets all state | — |
| `setVisitStatus(status)` | updates `visitStatus` | — |
| `toggleListId(id)` | adds/removes from `selectedListIds` | — |
| `toggleTagId(id)` | adds/removes from `selectedTagIds` | — |
| `startImport(total)` | phase → `"importing"`, resets counters, clears `cancelled` | — |
| `updateProgress(current, items)` | updates counters mid-loop | — |
| `requestCancel()` | sets `cancelled = true` (the loop checks this between batches) | — |
| `finishImport(result)` | phase → `"done"`, stores result, sets `current = result.total` | — |
| `setReviewsEnriching(v)` | toggle for the background-reviews phase | — |
| `reset()` | full reset to initial state | — |

## Phase machine

```
        ┌─────────────┐
        │   idle      │  no file selected
        └──────┬──────┘
               │ setFile(name, size)
               ▼
        ┌─────────────┐
        │   options   │  user picks visit status, lists, tags
        └──────┬──────┘
               │ startImport(total)
               ▼
        ┌─────────────┐
        │  importing  │  loop posts /api/places/import-batch
        └──────┬──────┘
               │ finishImport(result) | requestCancel()
               ▼
        ┌─────────────┐
        │    done     │  result displayed, reviews enriching in background
        └─────────────┘
```

`reset()` returns to `idle` from any phase. The `cancelled` flag triggers the running loop to exit (the loop checks `getState().cancelled` between batches).

## Persistence

**None.** Refreshing the page loses everything. Acceptable because:

- Imports run in foreground (the user is on `/import` watching progress).
- Resuming a half-finished import would need server-side state too (which places were imported).

If we ever want pause/resume across full reloads, persist to `localStorage` with `zustand/middleware/persist` and keep `importedPlaceIds` so we can skip already-imported records.

## Consumers

- `src/app/(app)/import/page.tsx` — the entire import UI.

## Edge cases

- **Module-scope persistence.** Navigate to `/places`, the import keeps running, come back to `/import` — you'll see the live progress. Useful behavior.
- **Cancel is cooperative.** The loop must check `cancelled` between API calls. If a single batch is mid-flight, cancel doesn't abort it — it just stops the next batch.
- **Re-entering with an active import.** The import page reads the current `phase` on mount; if it's `"importing"`, the UI jumps straight to the progress card rather than the file picker.
