---
title: useVisits
type: hook
domain: frontend
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/lib/hooks/use-visits.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/visits]]"
  - "[[../../02-backend/api-routes/visits]]"
  - "[[../components/visits]]"
---

# `useVisits` and family

| Hook | Does |
|---|---|
| `useVisits(placeId)` | `["visits", { placeId }]` — the place's visits, newest first |
| `useLogVisit()` | `POST /api/visits` → `{ visit, created, place }` |
| `useEditVisit()` | `PATCH /api/visits/[id]` |
| `useDeleteVisit()` | `DELETE /api/visits/[id]` → `{ place, reopened_stop_id }` |

A visit write changes more than visits: the place's visit status and rating, and through its stop a plan. So every write invalidates `["visits"]`, `["plan"]` (a stop may be done or planned again) and `["places"]` (status and rating show on cards, the map, filters) — and returns the place's new summary (`place`) for a screen that holds the place in its own state (the place page does).

The visit dialog uses `useVisits` too: when the date picked for a new visit already has one, it shows that visit's rating and notes, so saving updates it knowingly ([[../components/visits]]).
