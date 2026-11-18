---
title: Visits routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/visits/route.ts
  - src/app/api/visits/[id]/route.ts
  - src/lib/api/http.ts
  - src/lib/visits/schema.ts
  - src/lib/visits/read.ts
  - src/lib/visits/write.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/visits]]"
  - "[[../schema/visits]]"
  - "[[../../03-frontend/hooks/use-visits]]"
---

# Visits routes

Four handlers in two files, thin like the plan routes: auth, zod, one call into `src/lib/visits/`, and `errorResponse` (`src/lib/api/http.ts`) for the module's errors. All require a signed-in user.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/visits` | `?place_id=&from=&to=&limit=` (dates `YYYY-MM-DD`, limit ≤ 500, default 50) | `Visit[]`, newest first, each with `place` (name, city, country, Maps link, category) and `plan` (id, name, day) |
| POST | `/api/visits` | `{ place_id? , plan_stop_id?, visited_on?, rating?, notes? }` — a place or a stop | `201 { visit, created: true, place }` for a new visit; `200 { …, created: false }` when the place's visit that day was updated |
| PATCH | `/api/visits/[id]` | `{ visited_on?, rating?, notes? }` — at least one; `null` clears rating / notes | `{ visit, created: false, place }` |
| DELETE | `/api/visits/[id]` | — | `{ place, reopened_stop_id }` |

`place` in every write response is the place's summary afterwards — `{ id, visit_status, rating }` — so a screen holding the place updates it without a refetch.

## Errors

400 with the reason — the database's own words where it decided:

- "a visit can't be in the future (2026-11-21)"
- "there is already a visit to this place on 2026-11-16" (moving a visit onto another visit's day)
- "place … is not one of this user's places"
- "that stop has no saved place; mark it done instead of logging a visit"
- "the visit on … already fulfils another planned stop"

404 when the visit isn't the caller's.

## Checked

`npm run check:assistant -- visits` — 30 checks against the live database on the test account (18.11.2026): default date, same-day update, rating rules, a stop ticked off and reopened, the plan refusing to change a stop's status around its visit, date collisions, future dates, another user's place and visit, a favourite kept, the tools. Before any code, the SQL functions were run through 21 scenarios in a rolled-back transaction as the signed-in test user (including `anon` refused and the unique index).
