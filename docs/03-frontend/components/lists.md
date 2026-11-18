---
title: Lists components
type: component
domain: frontend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/components/lists/list-menu.tsx
  - src/components/lists/list-note-dialog.tsx
  - src/components/lists/use-list-editor.ts
  - src/app/(app)/lists/[id]/page.tsx
related:
  - "[[../../01-domain/lists]]"
  - "[[../hooks/use-lists]]"
  - "[[places]]"
  - "[[plans]]"
---

# Lists components

The list page and its parts (v1.40.0). The plan page's twins: `ListMenu` ↔ `PlanMenu`, `useListEditor` ↔ `usePlanEditor`.

## The list page — `src/app/(app)/lists/[id]/page.tsx`

- **Order and membership come from the list** (`useList`, `["lists", id]`); the cards and the map get their rows from `usePlaces({ list_id })`. A place whose row hasn't arrived (one just added) shows when it does; skeletons while the first rows load; "No places in this list yet" only when the list has none.
- **Drag to reorder** (`@dnd-kit`, pointer and touch): one `move_place` op whose position is the place's index in the list's order — the server's — never in the rows shown. The new order shows at once (the cached list takes it before the request).
- **Each place:** its note under the card (italic, up to three lines; tap to edit) and a menu — *Add a note* / *Edit note* opens `ListNoteDialog`; *Remove from list* takes it off at once and offers **Undo** for 8 s (`UNDO_TOAST_MS`), which puts it back at its position with its note.
- **Header:** back to `/lists`, the name and count, list / map view (kept in the URL as `?view=map`, like a plan), `ListMenu`. The description, when there is one, opens the list view.
- Not found (deleted, someone else's): "This list doesn't exist, or it was deleted." with a link back.

## `ListMenu` — `list-menu.tsx`

`⋯` (44 px hit area, `ICON_BUTTON`): **Copy share link** (`POST /api/shared`; the URL is shown in a toast when the clipboard is refused), **Rename**, **Add a description** / **Edit description**, **Delete list** — a dialog naming what goes ("The list and its notes are removed for good. Its N places stay saved."), not `confirm()`. Deleting navigates through `mutateAsync`: the delete unmounts the dialog, and `mutate()`'s per-call callbacks would never run.

## `ListNoteDialog` — `list-note-dialog.tsx`

The note on one place in one list: a textarea (2,000 characters; a counter appears near the limit), *Save* (disabled while unchanged), *Cancel*, and *Clear note* when there is one. A dialog rather than inline editing — on a phone the keyboard needs the room. Saving an empty note clears it (`set_note` with `null`).

## `useListEditor` — `use-list-editor.ts`

`apply(changes, { onDone, onFail })` over `useChangeList`: a refused change shows the server's sentence as a toast.
