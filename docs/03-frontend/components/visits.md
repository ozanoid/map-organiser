---
title: Visits components
type: component
domain: frontend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/components/visits/visit-dialog.tsx
  - src/components/visits/delete-visit-dialog.tsx
  - src/components/visits/place-visits.tsx
  - src/components/visits/rating.tsx
  - src/components/visits/visit-date.ts
  - src/components/ui/icon-button.ts
related:
  - "[[../../01-domain/visits]]"
  - "[[../hooks/use-visits]]"
  - "[[places]]"
  - "[[plans]]"
---

# Visits components

`src/components/visits/`, all client components; used by the place page ([[places]]) and the plan page's stop menu ([[plans]]).

| File | Component | What it is |
|---|---|---|
| `visit-dialog.tsx` | `VisitDialog` | Log a visit or correct one: date, rating (optional), notes (optional). Target `{ kind: "log", placeId, planStopId?, defaultDate }` or `{ kind: "edit", visit }`. |
| `delete-visit-dialog.tsx` | `DeleteVisitDialog` | Confirms deleting a visit — rating and notes go for good; says when the plan's stop goes back to planned and that the place stays visited. |
| `place-visits.tsx` | `PlaceVisitSummary`, `PlaceVisitList` | The line under the visit status ("2 visits · last on Sat 14 Nov" + **Log a visit**) and the **Visits** section (rows with date, stars, notes, a link to the plan; edit and delete). |
| `rating.tsx` | `StarRatingInput`, `RatingStars` | Five 36 px star buttons (a radio group; tapping the chosen star clears it) and a read-only row of stars. |
| `visit-date.ts` | `visitDateLabel` | "Sat 14 Nov" this year, "14 Nov 2025" otherwise. |

`src/components/ui/icon-button.ts` (`ICON_BUTTON`) is the class for icon-only buttons — 36 px visible, 44 px hit area — shared with the plan components.

## Behaviour worth knowing

- **Same day, one visit.** When the date picked for a new visit already has a visit, the dialog says "You already logged a visit on … — saving updates it" and shows that visit's rating and notes (until you change them). Nothing typed earlier is overwritten unseen.
- **No future dates:** the date input stops at today and an inline message explains; Save is disabled.
- **The dialog can't be dismissed while saving.**
- **The place page updates in place:** a write returns the place's new status and rating, which replace the page's copy — the "Visited" chip and "Your rating" stars move at once.
- **Marking a place "Visited"** shows a toast with **Log the visit** (8 s) — the flag alone has no date.
- **From the plan:** **Mark as done…** opens the dialog for the stop's place with the stop's day as the date (today if the day hasn't come), and says it marks the stop done.

## Checked in the browser

18.11.2026, Chrome, test account, live database (written visits deleted afterwards; the two places restored): log with rating and notes → status and stars updated; same-day prefill; future date blocked; an older lower-rated visit didn't change the rating; edit 4 → 5 moved the rating; deleting the latest fell back to the older visit's rating, deleting the last cleared it, the place stayed visited; the "Log the visit" toast; on the plan page Mark as done… (stop ticked, ★4 shown), Mark as not done… (visit deleted, stop planned), Mark as skipped / planned. No console error.

One thing seen only locally: classes used only by files created after the dev server's last start (`gap-x-2` here) were missing until the stylesheet was recompiled — the dev server's persistent CSS cache. A production build compiles from scratch.
