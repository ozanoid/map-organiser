---
title: Vault Guide
type: meta
domain: meta
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[frontmatter-schema]]"
  - "[[../_agent/conventions]]"
  - "[[../README]]"
---

# Vault Guide

How to read, navigate, and contribute to this vault.

## Purpose

Single source of truth for everything about map-organiser, written for two audiences in parallel:

1. **The human maintainer** — onboarding, design rationale, system shape.
2. **Claude Code (the coding agent)** — file-level conventions, recipes for common tasks, traps to avoid.

Every doc is written so both can act on it without needing the other.

## How to navigate

- **Top-down.** Start at [[../README]], drill into the numbered folder for your area.
- **By backlink.** In Obsidian, the right-hand backlinks panel shows everything that mentions the current doc. Faster than search for "where is this used".
- **By frontmatter.** Each doc carries `type`, `domain`, `status`, `sources`. Obsidian's Dataview / Properties view lets you slice across the whole vault (e.g. "show me every `type: table` that's `status: draft`").
- **By source file.** The `sources:` field lists every repo path a doc covers. To find docs touching a given file, search the vault for that path.

## Folder semantics

| Folder | Contains | `type:` values | `domain:` values |
|---|---|---|---|
| `_agent/` | Coding agent guidance | `meta`, `agent-note` | `agent` |
| `_meta/` | Vault meta, templates, schema | `meta` | `meta` |
| `_archive/` | Superseded docs | (preserved from original) | (preserved) |
| `00-overview/` | High-level system docs | `overview` | `overview` |
| `01-domain/` | Domain entities | `entity` | `places`, `trips`, `lists`, `sharing`, `users`, `geo` |
| `02-backend/` | Supabase + API | `overview`, `table`, `route-group`, `runbook` | `backend`, `auth` |
| `03-frontend/` | Next.js client | `overview`, `component`, `hook`, `store`, `route-group` | `frontend`, `design-system` |
| `04-integrations/` | Third-party | `integration` | `integrations` |
| `05-flows/` | User/data flows | `flow` | (the domain the flow lives in) |
| `06-ops/` | Deploy, runbooks | `overview`, `runbook` | `ops` |

## Frontmatter at a glance

Every doc starts with YAML frontmatter. The full schema with all allowed values lives in [[frontmatter-schema]]. The fields you'll always set:

- `title` — readable title (different from filename).
- `type` — controlled vocab (see schema).
- `domain` — controlled vocab.
- `version` — semver. Start at `1.0.0`. Bump per [[frontmatter-schema#Versioning]].
- `last_updated` — `DD.MM.YYYY`. Update on every meaningful edit.
- `status` — `draft` / `stable` / `deprecated` / `superseded`.
- `sources` — list of repo paths this doc covers (when applicable).
- `related` — list of wiki-links to related docs (when applicable).

## File naming

- **Stable.** Don't put version or date in filenames — they break wiki-links. The frontmatter handles those.
- **Kebab-case.** `place-import-flow.md`, not `placeImportFlow.md` or `Place Import Flow.md`.
- **Singular for entities** (`place.md`, `trip.md`), **plural is fine for grouping** (`api-routes/`, `hooks/`).
- **`_README.md` for folder intros** — when a sub-folder needs a landing page (e.g. `02-backend/schema/_README.md`).

## Wiki-links

- Prefer `[[target]]` over relative paths. Obsidian resolves by filename; if the filename is unique, no folder prefix needed.
- For ambiguous names, use a path: `[[01-domain/places]]`.
- For section links: `[[frontmatter-schema#Versioning]]`.
- For renamed display: `[[places|the place entity]]`.

## When you add a new doc

1. Pick the right folder (see Folder semantics above).
2. Copy the matching template from `_meta/templates/`.
3. Fill in frontmatter. Start `version: 1.0.0`, `status: draft`.
4. Write content.
5. When ready, flip `status: stable`.
6. Add an entry to [[../CHANGELOG]].
7. From any related doc, add this one to its `related:` list.

## When you edit an existing doc

1. Bump `version` per [[frontmatter-schema#Versioning]].
2. Update `last_updated`.
3. Add an entry to [[../CHANGELOG]] under today's date.
4. If `sources:` is now wrong (files moved/renamed/removed), fix it.

## When you rename a doc

Don't, if you can avoid it — it breaks wiki-links across the vault. If you must:

1. Use `git mv` so history follows.
2. Use Obsidian's "find and replace" (or `rg`) to update every wiki-link.
3. Add a CHANGELOG entry noting the rename.

## Archive policy

- Superseded docs go to `_archive/` with their original filenames + frontmatter intact.
- Add `status: superseded` and `superseded_by: "[[new-doc]]"` to their frontmatter.
- Don't link to archived docs from live docs (except from [[../_archive/_README]]).
