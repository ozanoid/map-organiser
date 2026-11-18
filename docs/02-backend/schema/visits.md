---
title: visits
type: table
domain: backend
version: 1.1.0
last_updated: 18.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118005402_visits.sql
  - supabase/migrations/20261118025122_visits_one_per_day.sql
  - supabase/migrations/20261118025152_visit_functions.sql
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[plans]]"
  - "[[../rls-policies]]"
  - "[[../../_plans/phase-1-planning]]"
  - "[[../../01-domain/visits]]"
  - "[[../api-routes/visits]]"
---

# `visits`

What actually happened: "I was at this place on this date" — with a rating and a note for that visit. Created on 18.11.2026 (`visits`); used by the app since v1.38.0 — the rules are in [[../../01-domain/visits]].

Before this table a visit was flattened onto the place (`places.visit_status`, `rating`, `notes`): a second visit, its own rating or what was eaten that day had nowhere to go. The place keeps those summary fields; logging a visit updates them. The `visited` flag can still be set without a visit (old visits with no known date).

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `place_id` | uuid | no | — | FK → `places.id`, ON DELETE CASCADE. |
| `visited_on` | date | no | — | Local date at the place. |
| `rating` | smallint | yes | — | CHECK 1–5. This visit's rating. |
| `notes` | text | yes | — | What I ate, how it was. |
| `plan_stop_id` | uuid | yes | — | FK → `plan_stops.id`, ON DELETE SET NULL. UNIQUE — one visit per planned stop. NULL for a visit logged on its own. |
| `created_via` | text | no | `'app'` | CHECK `app` \| `assistant` \| `feedback` (a reply to a "did you go?" message, Phase 4). |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |

## Indexes

| Name | Columns | Purpose |
|---|---|---|
| `visits_pkey` | `id` | Primary key. |
| `visits_plan_stop_key` | `plan_stop_id` UNIQUE | One visit per stop. |
| `visits_user_date_idx` | `(user_id, visited_on desc)` | A user's visit history. |
| `visits_place_idx` | `(place_id, visited_on desc)` | A place's visits; its latest rated visit. |
| `visits_place_day_key` | `(user_id, place_id, visited_on)` UNIQUE | One visit per place per day (`visits_one_per_day`, 18.11.2026, Ozan's decision). |

## RLS policies

| Policy | CMD | Role | USING | WITH CHECK adds |
|---|---|---|---|---|
| Users manage own visits | ALL | authenticated | `auth.uid() = user_id` | the place is the user's own; `plan_stop_id` is NULL or a stop of the user's own plan |

Checked on 18.11.2026 as a signed-in user inside a rolled-back transaction: a visit to an own place accepted, to a foreign place blocked, rating 6 rejected; another account and anon see none.

## Functions — the write path

Applied 18.11.2026 (`visit_functions`), SECURITY INVOKER, `EXECUTE` for `authenticated` and `service_role` only; ownership is also checked through `p_user_id` (the service role bypasses RLS). Called only by `src/lib/visits/write.ts`.

| Function | What it does |
|---|---|
| `log_visit(p_user_id, p_visit jsonb) → jsonb` | Log: `{ place_id? , plan_stop_id?, visited_on, rating?, notes?, created_via? }` — a place, or a stop whose place it takes. The place's visit that day, if there is one, is updated (keys left out kept); otherwise a row is inserted. Marks the place `visited` (not a `favorite`). Correct: `{ visit_id, visited_on?, rating?, notes? }`. Both then link a planned stop at that place on that day if the visit has none, set the stop `done`, and sync the rating. Returns `{ visit, created, place: { id, visit_status, rating } }`. |
| `delete_visit(p_user_id, p_visit_id) → jsonb` | Deletes; a stop it fulfilled goes back to `planned`; rating synced; the place stays visited. Returns `{ deleted, place, reopened_stop_id }`. |
| `visit_sync_rating(p_place_id, p_before_id, p_before_rating)` | The place's rating after a change: if the latest rated visit (by date) changed, the place takes its rating; if none is left and the place still shows the gone one's rating, it is cleared. Otherwise untouched — a hand-given rating stays. |

Refusals (errcode `22023`, message for the caller): a rating outside 1–5, a date more than a day ahead of UTC, a place that isn't the user's, a stop that isn't, a free-text stop, a stop at another place, a stop already fulfilled by another visit, moving a visit onto a day that has one. `P0002`: the visit isn't the caller's.

Checked on 18.11.2026 in a rolled-back transaction as the signed-in test user, 21 scenarios: logging (with auto-link to a planned stop), the same day again, an older visit not changing the rating, editing the latest, a hand rating kept, deleting latest → previous → none (rating cleared, status kept), future and foreign refused, the plan's guard both ways, a visit on a free-text stop refused, a favourite kept, a date collision refused, another user and `anon` refused, the unique index. The function bodies in the database hash-match the repo file.

## Notes

- Deleting a place deletes its visits (CASCADE), like its plan stops. Both delete dialogs count them (`visitCounts`, bulk action `check_delete`).
- `places.visited_at` stays what it was: when the place was first marked visited (stamped by the status code paths and by `log_visit`). Visit dates live here.
- Photos and companions are not modelled yet; they attach here later (Phase 3 / 4).
