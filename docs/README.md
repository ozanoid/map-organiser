# map-organiser docs vault

This is the canonical documentation vault for **map-organiser**. It's an Obsidian-compatible vault — folders are structured, wiki-links (`[[...]]`) are used throughout, and every doc carries frontmatter so you can pivot through metadata.

**Audience:** the human maintainer + Claude Code (the coding agent).

## Start here

| If you're... | Read this first |
|---|---|
| New to the repo | [[00-overview/system-overview]] then [[00-overview/tech-stack]] |
| Adding code | [[_agent/conventions]] + the relevant `common-tasks` recipe |
| Adding a new doc | [[_meta/vault-guide]] + [[_meta/frontmatter-schema]] |
| Touching the DB | [[02-backend/schema/_README]] |
| Touching auth | [[02-backend/auth]] + [[05-flows/auth-flow]] |

## Folder map

- `_agent/` — guidance for Claude Code (conventions, common tasks, pitfalls)
- `_meta/` — vault-level meta (schema, templates, this guide)
- `_archive/` — superseded docs kept for historical reference
- `00-overview/` — high-level system, tech stack, glossary
- `01-domain/` — domain entities (places, trips, lists, sharing, …)
- `02-backend/` — Supabase clients, schema, RLS, API routes
- `03-frontend/` — Next.js routes, components, hooks, stores, design system
- `04-integrations/` — third-party services (Mapbox, Google Places, DataForSEO, …)
- `05-flows/` — user/data flows (auth, import, trip planning, …)
- `06-ops/` — deployment, env vars, runbooks

## Conventions in 30 seconds

- **Stable filenames.** Version and last-updated date live in frontmatter, not the filename.
- **`status: stable` is the bar.** `draft` means "WIP, do not rely on yet". `deprecated`/`superseded` means "ignore".
- **`sources:` is sacred.** It lists every source-code path the doc covers — if those files change, the doc must be reviewed.
- **Wiki-links over relative paths.** `[[01-domain/places]]` not `../01-domain/places.md`.
- **Dates are `DD.MM.YYYY`.**

See [[_meta/vault-guide]] for the full picture, [[CHANGELOG]] for what's changed.
