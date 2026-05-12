---
title: "<Entity Name>"
type: entity
domain: places
version: 1.0.0
last_updated: DD.MM.YYYY
status: draft
sources: []
related: []
---

# <Entity Name>

> 1-paragraph definition: what this entity is, why it exists.

## Shape

The data shape — TypeScript type or Postgres schema. Source-of-truth lives in `[[../02-backend/schema/<table>]]`; mirror the field list here with semantics.

| Field | Type | Notes |
|---|---|---|

## Invariants

Rules that always hold (e.g. "a trip has at least one day", "a place belongs to exactly one user").

## Lifecycle

How the entity is created, updated, archived/deleted. Reference flows in `[[../05-flows/...]]`.

## Relationships

Other entities this one references or is referenced by. Use wiki-links.

## Code surface

Where this entity lives in the codebase:

- Backend table: `[[../02-backend/schema/<table>]]`
- API routes: `[[../02-backend/api-routes/<group>]]`
- Frontend hook: `[[../03-frontend/hooks/<hook>]]`
- Frontend components: `[[../03-frontend/components/<...>]]`

## Open questions

Anything unresolved. Delete this section when empty.
