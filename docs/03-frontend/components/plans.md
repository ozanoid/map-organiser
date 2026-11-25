---
title: Plans components
type: component
domain: frontend
version: 1.3.0
last_updated: 25.11.2026
status: stable
sources:
  - src/components/plans/plans-tab.tsx
  - src/components/plans/create-plan-dialog.tsx
  - src/components/plans/plan-day.tsx
  - src/components/plans/stop-row.tsx
  - src/components/plans/add-stop-dialog.tsx
  - src/components/plans/plan-menu.tsx
  - src/components/plans/plan-with-assistant.tsx
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
| `stop-row.tsx` | `StopRow` | One stop: drag handle, name or text, note or address, the visit's rating when done, time, cost, menu (done / skipped, move to another day, remove). |
| `add-stop-dialog.tsx` | `AddStopDialog` | Search the saved places, or add the typed text as a stop without a place. |
| `plan-menu.tsx` | `PlanMenu`, `PlanDatesDialog` | Share link, dates, rename, cancel / restore, delete (with a confirmation dialog). |
| `plan-with-assistant.tsx` | `PlanWithAssistant` | **Plan with assistant** (v1.53.0; the Gemini AI Plan dialog before): opens the assistant with "spread this plan over its days" — or, with fewer than two places, "fill it from my want-to-go places in <city>" — and the plan as subject ([[../../05-flows/ai-plan-flow]]). Hidden when the assistant can't be used. |

## The plan page (`/plans/[id]`)

- **Header, two rows.** Back to the Plans tab (a link, so it also works when the page was opened directly), the name, timeline / map toggle, the plan menu. Below: the dates (a button — "Set dates" when there are none), day and stop counts, the budget with the party-size stepper, AI Plan and Auto Plan.
- **The view is in the URL** (`?view=map`), so a refresh keeps it.
- **The days are always rendered**, also when the plan has no stops (in the trips page an empty trip showed only a message and "Add place" could not be reached).
- **Cancelled plan:** a banner with Restore; everything is read-only.
- **Not found / deleted:** a message and a link back; a failed load offers "Try again".

## Behaviour worth knowing

- **Reorder** shows the new order at once. The dragged order belongs to the stops array it was made from; when the server's answer replaces that array the override no longer applies — no effect clears it. While the save is on its way the legs are hidden (they belong to the old order).
- **Remove a stop** happens at once, with **Undo** in the toast: it adds a stop with the same content at the same position (place or text, time, note, cost — an emptied cost stays empty — and currency). It is a new row, so a stop's outcome (done / skipped, the visit linked to it) can't be put back; Undo is offered for planned stops only. The Undo goes through the day's editor, not the removed row's, so a failure is reported. The toast stays 8 s (`UNDO_TOAST_MS`) — the default 4 s was gone before a hand could reach it. No confirmation dialog.
- **Cancel a plan** is also undoable from the toast. **Delete** asks first — it can't be undone.
- **Time** (`StopTime`): a popover with an exact time or one of four parts of the day, and "Clear time". Setting one clears the other (the server's rule).
- **Cost** (`CostBadge`): tap, type, Enter or leave the field. Empty clears; a comma decimal is accepted.
- **Touch:** nothing depends on hover. Icon buttons are 36 px with a 44 px hit area (`ICON_BUTTON` in `src/components/ui/icon-button.ts`, shared with the visit components); menu items are 36 px tall or more.
- **Plan with assistant** opens the panel; the plan changes only when the user approves the assistant's card, and the page refreshes after the save (v1.53.0; the Gemini AI Plan rewrote the days at once).
- **Add day** stops at 60 days (the database's limit too).
- **Done and skipped** (stop menu): at a saved place **Mark as done…** opens the visit dialog for that place and the stop's day (today if the day hasn't come) — saving logs the visit and ticks the stop; then **Edit visit…** and **Mark as not done…** (deletes the visit after a confirmation, the stop is planned again). A free-text stop has **Mark as done** / **Mark as not done** directly. Any planned stop can be **Mark as skipped**, and back with **Mark as planned**. `done` shows a check and the visit's ★ rating; `skipped` a struck-through name and a chip. See [[visits]].

## Checked in the browser

18.11.2026, Chrome, signed in as the test account, against the live database (temporary plans, deleted afterwards; the existing plans were only read — trips ↔ plans still identical row by row):

- Plans tab: groups (Upcoming / Past), "New Plan" empty and from a list (6 places → day 1, cost defaults), lands on the new plan.
- Plan page: existing plans render with dates, routes, legs, AI notes; an empty plan shows its days and "Add stop".
- Add a saved place, add a free-text stop; exact time and part of the day; cost (comma decimal); drag to reorder; move to another day; remove + Undo.
- Add a day, move a day, remove an empty day (refused entry disabled for a day with stops); route mode (walking → driving changed the route); dates (set → day dates and range); party size; rename; cancel → read-only banner → restore; delete with confirmation → back at the list, the plan's URL then says it doesn't exist.
- Auto Plan; AI Plan (one real generation — [[../../05-flows/ai-plan-flow#Verified]]).
- Map view with day routes and the day filter; `?view=map` survives a reload; `/trips/<id>` opens the plan.
- Share link of an already shared plan (the existing link came back, no new row); "Save to my plans" from the public page (a copy with the times, without notes).
- Network: 23 edits, each one `PATCH` answering 200 in 240–555 ms; a route request only after an edit that changed a day's located stops or its profile. No console error, no server error.

Not checked: a real 375 px phone width (the desktop window stops at 500 px — the layout holds there and nothing overflows), keyboard-only reordering, the AI Plan pool option.

## Map

`MapView` is typed for full `Place` rows; a plan carries a lighter `PlanPlace`. The cast is in one function (`mapPlaces` in the page), which also drops stops without coordinates and repeated places. Route lines use the day's colour (`dayColor`, shared with the public share view).
