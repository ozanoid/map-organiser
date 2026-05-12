---
title: Archive
type: meta
domain: meta
version: 1.0.0
last_updated: 12.05.2026
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
| `test-plan_v1.md` | Test strategy (v1) |
| `test-plan_v2.md` | Test strategy (v2, 2026-04-16) |
| `dataforseo-vs-google-places-analysis.md` | API provider comparison |

## Redistribution checklist

The migration pass will:

1. Extract still-relevant content into appropriate vault docs (with attribution).
2. Mark the archived doc `status: superseded` and add `superseded_by: "[[new-doc]]"` to its frontmatter.
3. Log the migration in [[../CHANGELOG]].

Until then, treat these as **read-only historical reference**.
