---
title: Pitfalls
type: agent-note
domain: agent
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[conventions]]"
---

# Pitfalls

Things that will look right based on training data but will break in this codebase. Read before writing Next.js, React, Supabase, or Tailwind code.

> This is the rare doc that should grow over time. When you (or the user) discover a new trap, add it here with a one-line title, the trap, why it bites, and the fix.

## Next.js 16

- **Pages Router is gone in this repo.** Everything is App Router. Don't suggest `getServerSideProps`, `getStaticProps`, `pages/_app.tsx`. Routes live in `src/app/`.
- **Don't trust your training data for Next.js APIs.** v16 has breaking changes. When unsure, read `node_modules/next/dist/docs/` directly — it ships with the install.
- **`async` Server Components are the default.** A function exported from `app/.../page.tsx` without `"use client"` is a Server Component. It can `await` directly. Don't add `useEffect` to fetch — fetch in the component body.
- **`"use client"` is contagious.** Once a component has it, everything it imports runs client-side. Push state to the leaves; keep `page.tsx` server-side when you can.
- **Route handlers vs middleware.** `route.ts` runs per-request and can be Node or Edge. `middleware.ts` runs before route resolution. Different APIs — don't conflate.
- **No `pages/_document.tsx`.** Custom `<head>` goes through the `metadata` export or `app/layout.tsx`.

## React 19

- **`use` hook exists** and can unwrap promises in Server Components — but check the actual signature in the React 19 docs before using.
- **`forwardRef` is rarely needed** in React 19 — `ref` can be a regular prop. Don't auto-add `forwardRef`.

## Supabase (`@supabase/ssr`)

- **Three clients, three contexts.** See [[conventions#supabase-clients]]. Using the wrong one silently breaks auth — there's no error, just an unauthenticated user.
- **Cookies are written by middleware.** If you change auth flow, ensure `src/middleware.ts` still runs and still calls `updateSession`.
- **No local migrations.** Schema changes happen in the dashboard or via Supabase MCP. Don't `prisma migrate dev` — there's no Prisma. Don't expect `supabase/migrations/` to exist.

## Tailwind v4

- **No `tailwind.config.js`.** Config is CSS-side in `src/app/globals.css` via `@theme`. Adding a new color/token means editing the `@theme` block, not a JS config.
- **CSS variables are first-class.** Tokens are `--color-foreground`, etc. Reference them in arbitrary classes via `text-[--color-foreground]` if needed.
- **`@apply` works but is discouraged** — prefer composing utilities inline or with `cva`.

## State management

- **Don't reach for Context** for shared state. Use Zustand (existing pattern) or TanStack Query (existing pattern).
- **Don't mix server state into Zustand.** Server-cached data belongs in React Query. Zustand is for UI/transient state.

## Encryption & secrets

- `ENCRYPTION_SECRET` is server-only. Never log it, never expose to the client, never commit to git.
- Encrypted columns (`google_api_key_enc`, `mapbox_token_enc`) — only decrypt server-side.
- Never propose `console.log(process.env.ENCRYPTION_SECRET)` even in a debug context.

## Imports

- Don't add `import 'server-only'` to a file the client also needs. The build will fail loudly. Use the alias-and-split pattern if a module has both faces.
- Don't import `next/server` types in a client component — they don't ship to the browser.

## Mapbox

- `NEXT_PUBLIC_MAPBOX_TOKEN` is public by design — restricted by URL on the Mapbox side. Don't treat it as a secret.
- Map components must be client components (`"use client"`) — they touch `window`.

## PWA / offline

- Service worker registration lives in `src/components/sw-register.tsx`. Don't move it. Don't duplicate the registration.
- `/offline` route is the fallback. Anything that has to work offline must be cached deliberately.

## Docs

- **Never put `version` or `last_updated` in a filename.** Wiki-links break on rename. Frontmatter only.
- **Never delete an archived doc.** Move to `_archive/`, set `status: superseded`.
