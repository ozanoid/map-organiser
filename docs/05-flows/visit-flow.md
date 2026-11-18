---
title: Visit Flow
type: flow
domain: visits
version: 1.1.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/visits/route.ts
  - src/app/api/visits/[id]/route.ts
  - src/lib/visits/write.ts
  - src/components/visits/visit-dialog.tsx
  - src/components/plans/stop-row.tsx
  - src/components/places/place-detail-view.tsx
  - src/lib/assistant/tools/log-visit.ts
  - supabase/migrations/20261118025152_visit_functions.sql
related:
  - "[[../01-domain/visits]]"
  - "[[plan-flow]]"
  - "[[../04-integrations/claude-mcp]]"
---

# Visit Flow

"I went" — from the place page, the plan, or Claude — and what it changes.

## 1. From the place page

**Log a visit** (or **Log the visit** in the toast after marking it Visited) → date (default today), rating, notes → `POST /api/visits` → `logVisit` → `log_visit`:

1. The place must be the user's; the date not in the future.
2. A visit to that place on that day already? Update it (keys left out are kept). Otherwise insert.
3. The place becomes `visited` (a favourite stays a favourite).
4. A planned stop at that place on that day, in a plan that isn't cancelled? Link it; the stop becomes `done`.
5. The latest rated visit changed? The place's rating follows it.

The response carries the place's new status and rating; the page shows them at once.

## 2. From the plan page

Stop menu → **Mark as done…** → the same dialog, for the stop's place and the stop's day → `POST /api/visits { plan_stop_id }` → the same function, with the stop named instead of found. **Mark as not done…** → confirmation → `DELETE /api/visits/[id]` → `delete_visit`: the visit goes, the stop is `planned` again, the rating is recomputed, the place stays visited.

A free-text stop ("Meet at the Old Street exit") is ticked off with `PATCH /api/plans/[id] { ops: [update_stop status] }` — there is no place to have visited.

## 3. From Claude

"Went to Dishoom last night, 4 stars, the black daal was great" → `log_visit { place_id, visited_on, rating, notes }` (`created_via = assistant`). With no date, today at the place. A visit that fulfils a stop Claude saw in `get_plans` → `log_visit { plan_stop_id, … }` (v1.39.0): the same as the stop menu's **Mark as done…** — that stop is ticked off whatever its day, and its day is the default date (today if the day is still ahead). Correcting: `log_visit { visit_id, … }`. Reading back: `get_visits`, `get_plans` (each stop shows its visit), and `get_places` shows the last visits.

## Failure modes

- Future date, another visit on the target day, a stop at another place, a place that isn't the user's → 400 with the reason; nothing changed.
- The plan's write path refuses to set a stop at a saved place done, or to change a stop that has a visit — those go through the visit.
