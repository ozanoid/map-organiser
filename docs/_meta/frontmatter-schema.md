---
title: Frontmatter Schema
type: meta
domain: meta
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[vault-guide]]"
---

# Frontmatter Schema

The full YAML frontmatter spec for every doc in the vault. Treat the controlled vocabularies as closed sets — adding a new value means updating this doc.

## Fields

### Required

| Field | Type | Example | Notes |
|---|---|---|---|
| `title` | string | `Place Entity` | Readable. Different from filename. |
| `type` | enum | `entity` | See [Types](#types) below. |
| `domain` | enum | `places` | See [Domains](#domains) below. |
| `version` | semver string | `1.2.0` | See [Versioning](#versioning) below. |
| `last_updated` | date `DD.MM.YYYY` | `12.05.2026` | Update on every meaningful edit. |
| `status` | enum | `stable` | `draft` / `stable` / `deprecated` / `superseded`. |

### Optional

| Field | Type | Example | When to use |
|---|---|---|---|
| `sources` | list of repo paths | `[src/lib/supabase/client.ts]` | Whenever the doc describes specific code. |
| `related` | list of wiki-links | `[[[auth]], [[supabase-clients]]]` | Cross-references. |
| `tags` | list of strings | `[security, encryption]` | Free-form, lowercase, kebab-case. |
| `superseded_by` | wiki-link | `[[new-doc]]` | Only for `status: superseded`. |
| `owner` | string | `ozan` | When responsibility is non-default. |

## Types

Each `type` value maps to a folder and a template:

| `type` | Template | Folder | Meaning |
|---|---|---|---|
| `meta` | — | `_meta/`, `_archive/` | Vault meta docs (this one is `meta`). |
| `agent-note` | `agent-note.md` | `_agent/` | Specific guidance for Claude Code. |
| `overview` | `overview.md` | `00-overview/`, folder `_README.md`s | High-level system or area overview. |
| `entity` | `entity.md` | `01-domain/` | A domain entity (place, trip, list…). |
| `table` | `table.md` | `02-backend/schema/` | A Supabase/Postgres table. |
| `route-group` | `route-group.md` | `02-backend/api-routes/`, `03-frontend/` | A group of related routes. |
| `component` | `component.md` | `03-frontend/components/` | A frontend component or component family. |
| `hook` | `hook.md` | `03-frontend/hooks/` | A custom React hook. |
| `store` | `store.md` | `03-frontend/stores/` | A Zustand store. |
| `integration` | `integration.md` | `04-integrations/` | A third-party service or library. |
| `flow` | `flow.md` | `05-flows/` | A user or data flow spanning the system. |
| `runbook` | `runbook.md` | `06-ops/runbooks/` | An operational procedure. |

## Domains

The `domain` value answers "what area of the app does this concern":

- `meta` — vault meta
- `agent` — coding agent guidance
- `overview` — system-wide
- `places`, `trips`, `lists`, `sharing`, `users`, `geo` — domain areas
- `auth` — authentication
- `backend` — Supabase, API routes, anything server-side
- `frontend` — Next.js client
- `design-system` — tokens, shadcn, Tailwind
- `integrations` — third-party
- `ops` — deploy, env, monitoring

## Status

| Value | Meaning | Linkable from live docs? |
|---|---|---|
| `draft` | WIP. Don't rely on yet. | Yes (with caveat) |
| `stable` | Reviewed and current. | Yes |
| `deprecated` | No longer relevant but kept for context. | Avoid |
| `superseded` | Replaced by another doc. Set `superseded_by`. | No |

## Versioning

The doc's `version` field uses semver against the doc's content, not the code it describes:

- **MAJOR** — content restructured, sections removed or renamed, breaking change in how readers should interpret the doc.
- **MINOR** — new section added, scope expanded, meaningful new information.
- **PATCH** — typo fix, link update, small correction.

Every version bump must update `last_updated` and add a CHANGELOG entry.

Initial version for a new doc: `1.0.0`.

## Dates

`DD.MM.YYYY`. Example: `12.05.2026`. Obsidian parses this as a date when its locale is Turkish/European — that's intentional, the UI shows it nicely.

## Example

A complete frontmatter block:

```yaml
---
title: Place Import Flow
type: flow
domain: places
version: 1.2.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/places/import/parse/route.ts
  - src/app/api/places/import/batch/route.ts
  - src/app/(app)/import/page.tsx
  - src/lib/stores/import-store.ts
related:
  - "[[places]]"
  - "[[google-places]]"
  - "[[import-store]]"
tags:
  - import
  - bulk
---
```
