---
title: Visit
type: entity
domain: visits
version: 1.0.1
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/visits/schema.ts
  - src/lib/visits/read.ts
  - src/lib/visits/write.ts
  - src/lib/hooks/use-visits.ts
  - src/lib/assistant/tools/log-visit.ts
  - src/lib/assistant/tools/get-visits.ts
  - supabase/migrations/20261118025152_visit_functions.sql
related:
  - "[[places]]"
  - "[[plans]]"
  - "[[../02-backend/schema/visits]]"
  - "[[../02-backend/api-routes/visits]]"
  - "[[../03-frontend/hooks/use-visits]]"
  - "[[../03-frontend/components/visits]]"
  - "[[../05-flows/visit-flow]]"
  - "[[../_plans/phase-1-planning]]"
---

# Visit

What actually happened: **one saved place on one day**, with that visit's own rating and notes ("lamb was great, wine average"). Added in v1.38.0 (Phase 1, slice 2 of [[../_plans/phase-1-planning]]); on main since 18.11.2026. Table: [[../02-backend/schema/visits]].

A **stop** in a [[plans|plan]] is an intention; a visit is the fact. A visit can fulfil a stop, or stand on its own (no plan, or a second visit to the same place).

## Rules (Ozan, 18.11.2026)

- **One visit per place per day.** Logging the same place and day again updates that visit — a field that is left out is kept, `null` clears it. A unique index makes this hold for any caller (the assistant retrying a call, the plan page and the place page both logging the same evening).
- **No visit in the future** (one day of slack for time zones ahead of UTC).
- **Logging marks the place visited.** A favourite stays a favourite. Deleting a visit doesn't unmark the place: "visited" can be set without a visit (an old visit whose date is unknown).
- **The place's rating follows its latest rated visit** — by visit date, not by when it was logged. It changes only when that latest rated visit changes: a later rated visit, its rating edited, it deleted. So a star given by hand on the place page stays until then, and logging an *older* visit never overrides the current rating. When the last rated visit goes and the place still shows its rating, the rating is cleared.
  - Known limit: a hand-given rating replaced by a visit's rating doesn't come back if that visit is deleted (the place keeps one rating column).
- **A visit can fulfil a planned stop** — named (`plan_stop_id`) or found: a stop of a planned (not cancelled) plan, still planned, at the same place, on that day. The stop becomes **done**; deleting the visit makes it **planned** again. A stop at a saved place is done *exactly* when it has a visit: the plan's own write path refuses to set it done (or undo it) any other way. A free-text stop is ticked off directly.
- **Deleting a place deletes its visits** (FK cascade). Both delete warnings say how many.

## One write path

Like plans: every write is one call into `src/lib/visits/write.ts`, which is one call to a Postgres function, which is one transaction — the visit, the place's summary and the stop change together or not at all.

| Function | Calls | Used by |
|---|---|---|
| `logVisit(ctx, input, { createdVia })` | `log_visit` | `POST /api/visits`, tool `log_visit` |
| `editVisit(ctx, id, changes)` | `log_visit` with `visit_id` | `PATCH /api/visits/[id]`, tool `log_visit` with `visit_id` |
| `deleteVisit(ctx, id)` | `delete_visit` | `DELETE /api/visits/[id]` |

`write.ts` adds the **default date**: the planned stop's day when it has come, otherwise **today at the place** (its Google time zone), so "I went last night" from London at 1 am lands on the right day. Errors: `VisitInputError` (400 / correctable by the model), `VisitNotFoundError` (404).

Reads (`src/lib/visits/read.ts`): `listVisits` (by places, date range, minimum rating; newest first; each with a light place and the plan it fulfilled), `getVisit`, `visitCounts` (for the delete warnings).

`created_via` records who logged it: `app`, `assistant`, `feedback` (Phase 4's "did you go?" reply).

## Where it shows

- **Place page:** a line under the visit status ("2 visits · last on Sat 14 Nov" + **Log a visit**), and the **Visits** list above Notes — date, rating, notes, the plan; edit and delete. Marking a place "Visited" offers **Log the visit** in the toast. See [[../03-frontend/components/visits]].
- **Plan page:** a stop's menu — **Mark as done…** (logs the visit), **Edit visit…**, **Mark as not done…** (deletes the visit), **Mark as skipped** / **Mark as planned**. A done stop shows its visit's rating.
- **Claude:** `log_visit`, `get_visits`; `get_places` shows the last three visits and upcoming plans; `get_library_overview` counts visits ([[../04-integrations/claude-mcp]]).
- **Not shown publicly:** shared places, lists and plans carry no visits.

## Not yet

- Photos and companions of a visit (Phase 3 / 4 attach here).
- A history page of all visits in the app (Claude's `get_visits` covers it for now).
- The in-app assistant (Gemini) still only sets the visit status; it moves onto these tools in Phase 2.
