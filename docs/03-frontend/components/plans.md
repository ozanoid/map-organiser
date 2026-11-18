---
title: Plans components
type: component
domain: frontend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/components/plans/plans-tab.tsx
  - src/components/plans/create-plan-dialog.tsx
  - src/components/plans/plan-day.tsx
  - src/components/plans/stop-row.tsx
  - src/components/plans/add-stop-dialog.tsx
  - src/components/plans/plan-menu.tsx
  - src/components/plans/ai-plan-button.tsx
  - src/components/plans/use-plan-editor.ts
  - src/app/(app)/plans/[id]/page.tsx
related:
  - "[[../../01-domain/plans]]"
  - "[[../hooks/use-plans]]"
  - "[[../routing]]"
  - "[[../../05-flows/plan-flow]]"
---

# Plans components

Everything under `src/components/plans/` plus the plan page. All client components. They read with [[../hooks/use-plans]] and write through `usePlanEditor().apply({ set, ops })`.

| File | Component | What it is |
|---|---|---|
| `plans-tab.tsx` | `PlansTab` | The Plans tab of `/lists`: plan cards grouped Upcoming / No date yet / Past / Cancelled, "New Plan". |
| `create-plan-dialog.tsx` | `CreatePlanDialog` | Name, date (optional), number of days (stepper), start empty or from a list. Opens the new plan when it is created. |
| `plan-day.tsx` | `PlanDayTimeline` | One day: header (date, route length, day cost, route-mode button, day menu), its stops with the legs between them, "Add stop". Drag to reorder. |
| `stop-row.tsx` | `StopRow` | One stop: drag handle, name or text, note or address, time, cost, menu (move to another day, remove). |
| `add-stop-dialog.tsx` | `AddStopDialog` | Search the saved places, or add the typed text as a stop without a place. |
| `plan-menu.tsx` | `PlanMenu`, `PlanDatesDialog` | Share link, dates, rename, cancel / restore, delete (with a confirmation dialog). |
| `ai-plan-button.tsx` | `AiPlanButton` | The AI Plan entry and dialog ([[../../05-flows/ai-plan-flow]]). Hidden unless AI is enabled and available. |

## The plan page (`/plans/[id]`)

- **Header, two rows.** Back to the Plans tab (a link, so it also works when the page was opened directly), the name, timeline / map toggle, the plan menu. Below: the dates (a button — "Set dates" when there are none), day and stop counts, the budget with the party-size stepper, AI Plan and Auto Plan.
- **The view is in the URL** (`?view=map`), so a refresh keeps it.
- **The days are always rendered**, also when the plan has no stops (in the trips page an empty trip showed only a message and "Add place" could not be reached).
- **Cancelled plan:** a banner with Restore; everything is read-only.
- **Not found / deleted:** a message and a link back; a failed load offers "Try again".

## Behaviour worth knowing

- **Reorder** shows the new order at once. The dragged order belongs to the stops array it was made from; when the server's answer replaces that array the override no longer applies — no effect clears it. While the save is on its way the legs are hidden (they belong to the old order).
- **Remove a stop** happens at once, with **Undo** in the toast: it adds a stop with the same content at the same position (place or text, time, note, cost — an emptied cost stays empty — and currency). It is a new row, so a stop's outcome (done / skipped, the visit linked to it) can't be put back; Undo is offered for planned stops only. The Undo goes through the day's editor, not the removed row's, so a failure is reported. No confirmation dialog.
- **Cancel a plan** is also undoable from the toast. **Delete** asks first — it can't be undone.
- **Time** (`StopTime`): a popover with an exact time or one of four parts of the day, and "Clear time". Setting one clears the other (the server's rule).
- **Cost** (`CostBadge`): tap, type, Enter or leave the field. Empty clears; a comma decimal is accepted.
- **Touch:** nothing depends on hover. Icon buttons are 36 px with a 44 px hit area (`ICON_BUTTON`); menu items are 36 px tall or more.
- **AI Plan** can't be dismissed while it is generating, and other edits wait behind it (same write queue) — its result rewrites the days.
- **Add day** stops at 60 days (the database's limit too).
- **Stops that happened:** `done` shows a check, `skipped` a struck-through name and a chip. They can't be set from this page yet (Phase 1, slice 2).

## Map

`MapView` is typed for full `Place` rows; a plan carries a lighter `PlanPlace`. The cast is in one function (`mapPlaces` in the page), which also drops stops without coordinates and repeated places. Route lines use the day's colour (`dayColor`, shared with the public share view).
