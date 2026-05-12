---
title: Common Tasks
type: agent-note
domain: agent
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[conventions]]"
  - "[[pitfalls]]"
---

# Common Tasks

Checklists for frequent operations. Treat these as authoritative — if a checklist is wrong, fix the checklist (and bump its version) rather than working around it.

## Add a new API route

1. Create `src/app/api/<area>/.../route.ts` exporting handlers (`GET`, `POST`, etc.).
2. Add a Zod schema for the body (in `src/lib/types/` if shared, inline if not).
3. At the top of each mutation handler, get the server Supabase client and check auth.
4. Validate body with Zod; return `400` on failure.
5. Use `Response.json(data, { status })` to return.
6. Update `[[../02-backend/api-routes/<area>]]`: add the route to the table, add a per-route detail block, append source path to `sources:`.
7. If the route affects an entity, update that entity's "Code surface" section in `[[../01-domain/<entity>]]`.
8. Bump versions, update `last_updated`, log in [[../CHANGELOG]].

## Add a new DB table

> Schema is dashboard-managed. There's no local migrations folder.

1. Create the table in the Supabase dashboard (or via Supabase MCP `apply_migration`).
2. Add RLS policies. Default-deny if in doubt. Authenticated-only for user-owned data.
3. Create `docs/02-backend/schema/<table_name>.md` from the `table.md` template.
4. Fill columns, indexes, RLS policies, foreign keys.
5. Update `[[../02-backend/rls-policies]]` cross-reference.
6. If there's a related entity, link from `[[../01-domain/<entity>]]` → Code surface.
7. If you need generated types, regenerate them per the runbook (TBD — see `[[../06-ops/runbooks/regenerate-db-types]]` once it exists).
8. Log in [[../CHANGELOG]].

## Add a new domain entity

1. Decide whether it's a true entity (has identity, lifecycle, relationships) or just a value object.
2. Create `docs/01-domain/<entity>.md` from the `entity.md` template.
3. Fill shape, invariants, lifecycle, relationships.
4. Link Code surface to backend table, API routes, hooks, components.
5. Add to [[../README]]'s domain section if it's a top-level entity.
6. Log in [[../CHANGELOG]].

## Add a new custom hook

1. Create `src/lib/hooks/use-<name>.ts`.
2. If it wraps a server resource, use TanStack Query with a stable namespaced query key.
3. Export `useXxx`.
4. Create `docs/03-frontend/hooks/use-<name>.md` from the `hook.md` template.
5. Fill signature, behavior, dependencies, consumers, edge cases.
6. If the hook drives a domain entity, link from `[[../01-domain/<entity>]]`.
7. Log in [[../CHANGELOG]].

## Add a new Zustand store

1. Create `src/lib/stores/<name>-store.ts`.
2. Default to no persistence. Add `persist` middleware only with a reason.
3. Create `docs/03-frontend/stores/<name>-store.md` from the `store.md` template.
4. Document shape, actions, persistence, consumers.
5. Log in [[../CHANGELOG]].

## Add a new component family

1. Create `src/components/<area>/<Component>.tsx`.
2. If it's a primitive, use shadcn CLI: `npx shadcn add <component>`.
3. Create `docs/03-frontend/components/<area>.md` (or update existing) using `component.md`.
4. Fill API, behavior, composition, styling, examples.
5. Log in [[../CHANGELOG]].

## Add a new integration (third-party service)

1. Add env vars to `.env.local.example` (keys only, no values).
2. Create a domain folder under `src/lib/<service>/` for client wrappers.
3. Mark server-only modules with `import 'server-only'`.
4. Create `docs/04-integrations/<service>.md` from `integration.md`.
5. Document account, env vars, where used, cost, failure modes, replacement.
6. Update `[[../06-ops/env-vars]]` with the new vars.
7. Log in [[../CHANGELOG]].

## Add a new user flow

1. Implement the code (routes, hooks, components) following the relevant task above.
2. Create `docs/05-flows/<flow-name>.md` from `flow.md`.
3. Document trigger, steps (mermaid or numbered), inputs/outputs, failure modes, related code.
4. Cross-link from involved entities, routes, hooks.
5. Log in [[../CHANGELOG]].

## Update env vars

1. Edit `.env.local.example` (key only).
2. Update `[[../06-ops/env-vars]]` table.
3. If the var feeds an integration, update `[[../04-integrations/<service>]]`.
4. Log in [[../CHANGELOG]].

## Rename a file under `sources:`

1. Use `git mv` so history follows.
2. Grep the vault for the old path: `rg '<old/path>' docs/`.
3. Update every `sources:` list.
4. Log in [[../CHANGELOG]].
