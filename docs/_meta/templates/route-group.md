---
title: "<route group name>"
type: route-group
domain: backend
version: 1.0.0
last_updated: DD.MM.YYYY
status: draft
sources: []
related: []
---

# <Route Group>

> 1-paragraph: what this group of routes does as a whole.

## Routes

| Method | Path | Purpose | Auth |
|---|---|---|---|

## Per-route detail

### `<METHOD> /api/.../<path>`

- **Source:** `src/app/api/.../route.ts`
- **Auth:** required / public / role-gated
- **Body schema:** Zod schema name or inline
- **Response:** shape + status codes
- **Side effects:** DB writes, external API calls
- **Errors:** known failure modes

## Shared concerns

Validation, error handling, observability that applies across the group.
