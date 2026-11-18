---
title: visits
type: table
domain: backend
version: 1.0.0
last_updated: 18.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261118005402_visits.sql
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[plans]]"
  - "[[../rls-policies]]"
  - "[[../../_plans/phase-1-planning]]"
---

# `visits`

What actually happened: "I was at this place on this date" — with a rating and a note for that visit. Created on 18.11.2026 (`visits`). 0 rows; **no application code uses it yet** (Phase 1, slice 2 of [[../../_plans/phase-1-planning]]).

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
| `visits_place_idx` | `(place_id, visited_on desc)` | A place's visits. |

## RLS policies

| Policy | CMD | Role | USING | WITH CHECK adds |
|---|---|---|---|---|
| Users manage own visits | ALL | authenticated | `auth.uid() = user_id` | the place is the user's own; `plan_stop_id` is NULL or a stop of the user's own plan |

Checked on 18.11.2026 as a signed-in user inside a rolled-back transaction: a visit to an own place accepted, to a foreign place blocked, rating 6 rejected; another account and anon see none.

## Notes

- Deleting a place deletes its visits (CASCADE), like its plan stops. The delete warning in the UI should count them — part of slice 2.
- Photos and companions are not modelled yet; they attach here later (Phase 3 / 4).
