---
title: Coding Conventions
type: agent-note
domain: agent
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[common-tasks]]"
  - "[[pitfalls]]"
  - "[[../_meta/vault-guide]]"
---

# Coding Conventions

The rules Claude Code follows when writing or modifying code in this repo. Read this before any non-trivial edit. Read [[pitfalls]] for the don't-do list.

## Stack baseline

- **Next.js 16 App Router.** Not Pages Router. No `getServerSideProps`, no `getStaticProps`. Use Server Components, Server Actions, and `app/`-based routing. When unsure about an API: read `node_modules/next/dist/docs/` — training data is out of date.
- **React 19.** Server Components by default in `app/`. Client Components only when you need state, effects, or browser APIs (`"use client"` at top of file).
- **TypeScript 6.** Strict mode. Path alias: `@/*` → `./src/*`.
- **Tailwind v4.** Config is via CSS (`@theme` block in `globals.css`), not `tailwind.config.js`. CSS variables for tokens.
- **shadcn/ui** with `base-nova` style. Components installed to `src/components/ui/`. Don't reinvent — use shadcn primitives.
- **Supabase** via `@supabase/ssr`. Always use the right client for the right context (see [Supabase clients](#supabase-clients)).
- **State.** Zustand for client-only state, TanStack Query for server state. No Redux, no Jotai, no Context-as-store.

## File & folder layout

```
src/
  app/
    (app)/         authenticated pages
    (auth)/        login, signup
    api/           route handlers
    shared/        public shared views
    offline/       PWA offline fallback
  components/
    filters/, layout/, map/, places/, settings/, ui/
  lib/
    dataforseo/, google/, hooks/, map/, stores/, supabase/, trip/, types/
    geo.ts, utils.ts, providers.tsx
  middleware.ts
```

Rules:

- **Pages live in `app/`**, components in `components/`, primitives in `components/ui/`.
- **Hooks** that wrap data fetching live in `src/lib/hooks/`. Component-local hooks stay co-located.
- **API route handlers** in `src/app/api/.../route.ts`.
- **Domain-namespaced helpers** in `src/lib/<domain>/` (e.g. `src/lib/trip/`, `src/lib/google/`).
- **Server-only modules** that must never be imported from client code: add `import 'server-only'` at the top.

## Naming

- **Files & folders:** kebab-case.
- **React components:** `PascalCase.tsx`. Filename matches the component name.
- **Hooks:** `use-x.ts`, exporting `useX`.
- **Stores:** `x-store.ts`, exporting `useXStore`.
- **API route files:** always `route.ts`.

## Imports

- Use `@/...` for everything in `src/`.
- Group order: external → `@/lib/...` → `@/components/...` → `@/app/...` → relative `./`.
- No deep relative paths across folders (`../../../`). Use the alias.

## Supabase clients

There are three Supabase clients. Pick the one that matches your runtime:

| File | Use when |
|---|---|
| `src/lib/supabase/client.ts` | Client Components (`"use client"`) that need a browser client. |
| `src/lib/supabase/server.ts` | Server Components, Server Actions, Route Handlers. |
| `src/lib/supabase/middleware.ts` | The Next.js middleware (`src/middleware.ts`). |

Never import the browser client from a Server Component. Never import the server client from a Client Component. The wrong one will silently break auth.

## Auth & session

- Cookie-based session, managed by `@supabase/ssr`.
- Middleware refreshes the session on every request.
- In Server Components, get the session via the server client. Don't pass it through props from client to server.

## API routes

- Validate every body with **Zod** before doing anything.
- Always return `Response.json(...)` with an explicit status.
- For mutations, check auth via the server Supabase client at the top of the handler.
- Server-only env vars (e.g. `GOOGLE_PLACES_API_KEY`, `ENCRYPTION_SECRET`) — never expose to client. No `NEXT_PUBLIC_` prefix.

## State management

- **Server state** (anything backed by Supabase or an API) → TanStack Query. Use the hooks in `src/lib/hooks/` (e.g. `usePlaces`, `useTrips`).
- **Cross-component client state** → Zustand store in `src/lib/stores/`.
- **Component-local state** → `useState` / `useReducer`. Don't promote local state to a store.
- **Query keys**: stable arrays, namespaced by entity. Example: `["places", filters]`.

## Styling

- Tailwind utility classes inline. No CSS modules.
- For variants, use `cva` (class-variance-authority) — already a dep.
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Tokens come from CSS variables defined in `src/app/globals.css` under `@theme`. Don't hardcode colors; use `text-foreground`, `bg-card`, etc.

## Forms & validation

- Zod for schemas, both server- and client-side.
- Re-use schemas between API and frontend — define once in `src/lib/types/` (or co-located).

## Docs hygiene

After any non-trivial code change, the corresponding doc must be updated. See [[common-tasks]] for which docs to touch when.

Specifically:

- Touched a file listed in any doc's `sources:`? → bump that doc's `version`, update `last_updated`, log in [[../CHANGELOG]].
- Added a new file? → add it to the relevant doc's `sources:`.
- Added a new feature surface (route, hook, store, component family)? → write a new doc using the matching template.

## Commit & PR

- Commit messages: imperative, short ("Add reorder API for trip days"). Wrap at 72 chars.
- Don't `--amend` unless the user asks. Create a new commit.
- Never `--no-verify`. Fix the hook failure.
- Pre-commit hooks (if any) must pass.

## Things to ask before doing

For these, surface a one-liner before acting:

- DB schema changes (no migrations folder — confirm via dashboard / MCP).
- Anything that touches `ENCRYPTION_SECRET` or the encrypted columns.
- Production deploys (`vercel --prod`).
- Force-pushes, branch deletes.
- Permission/RLS changes.
