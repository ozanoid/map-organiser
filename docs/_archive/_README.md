---
title: Archive
type: meta
domain: meta
version: 1.2.0
last_updated: 18.11.2026
status: stable
---

# Archive

Superseded docs preserved for historical context. **Don't link to these from live docs.**

## Current archive

The original `docs/*_v1.md` and `*_v2.md` files were moved here on **12.05.2026** during the vault scaffold. Their content will be redistributed into the new structure (`01-domain/`, `02-backend/`, `03-frontend/`, etc.) in a subsequent pass.

| File | Original purpose |
|---|---|
| `system_v1.md` | High-level system overview (v1) |
| `system_v2.md` | High-level system overview (v2, 2026-04-16) |
| `system-design_v1.md` | Service architecture (v1) |
| `system-design_v2.md` | Service architecture (v2, 2026-04-16) |
| `design-system_v1.md` | Design philosophy & components (v1) |
| `design-system_v2.md` | Design philosophy & components (v2, 2026-04-16) |
| `feature-suggestions_v2.md` | Feature backlog & cross-codebase analysis (v2) |
| `feature-suggestions_v1.md` | Feature backlog (v1) |
| `feature-suggestions_v3.md` | Feature backlog (v3, 2026-04-17) |
| `feature-suggestions_v3-ai-first.md` | Feature backlog, AI-first variant of v3 |
| `feature-suggestions_v4.md` | Canonical roadmap of the multi-user product (v4, last 16.07.2026). Superseded on 17.11.2026 by [[personal-assistant]]. |
| `test-plan_v1.md` | Test strategy (v1) |
| `test-plan_v2.md` | Test strategy (v2, 2026-04-16) |
| `dataforseo-vs-google-places-analysis.md` | API provider comparison |
| `01-domain/trips.md` | The Trip entity (trips / trip_days / trip_day_places). Superseded on 18.11.2026 by `01-domain/plans`. |
| `02-backend/api-routes/trips.md` | The seven `/api/trips/**` route files. Superseded on 18.11.2026 by `02-backend/api-routes/plans`. |
| `03-frontend/hooks/use-trips.md` | `useTrips` and its 11 mutations. Superseded on 18.11.2026 by `03-frontend/hooks/use-plans`. |
| `05-flows/trip-planning-flow.md` | Create a trip → auto-plan → day edits. Superseded on 18.11.2026 by `05-flows/plan-flow`. |
| `05-flows/ai-trip-plan-flow.md` | The AI trip planner on the trips tables. Superseded on 18.11.2026 by `05-flows/ai-plan-flow`. |

The five trip docs keep their folder under `_archive/` because two of them share a filename (`trips.md`).

## Redistribution checklist

The migration pass will:

1. Extract still-relevant content into appropriate vault docs (with attribution).
2. Mark the archived doc `status: superseded` and add `superseded_by: "[[new-doc]]"` to its frontmatter.
3. Log the migration in [[../CHANGELOG]].

Until then, treat these as **read-only historical reference**.
