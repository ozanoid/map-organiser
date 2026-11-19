---
title: Pitfalls
type: agent-note
domain: agent
version: 1.6.0
last_updated: 19.11.2026
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
- **Every build warns that `middleware` is deprecated** (Next 16 renamed it `proxy`). `src/middleware.ts` stays until Ozan decides: it sets no runtime, so it runs on the middleware default, Edge; `proxy` runs only on Node.js, so the codemod (`middleware-to-proxy`) also moves the session check to another runtime on Vercel. Not a code error — don't "fix" it in passing.
- **No `pages/_document.tsx`.** Custom `<head>` goes through the `metadata` export or `app/layout.tsx`.

## React 19

- **`use` hook exists** and can unwrap promises in Server Components — but check the actual signature in the React 19 docs before using.
- **`forwardRef` is rarely needed** in React 19 — `ref` can be a regular prop. Don't auto-add `forwardRef`.

## Supabase (`@supabase/ssr`)

- **Three clients, three contexts.** See [[conventions#supabase-clients]]. Using the wrong one silently breaks auth — there's no error, just an unauthenticated user.
- **Cookies are written by middleware.** If you change auth flow, ensure `src/middleware.ts` still runs and still calls `updateSession`.
- **A redirect from the middleware must carry the session cookies.** `getUser()` may have just refreshed the session onto `supabaseResponse`; a bare `NextResponse.redirect` drops those cookies and leaves the browser with a spent refresh token. Use `redirectKeepingSession` in `src/lib/supabase/middleware.ts` (v1.39.0).
- **A cookie client outside a cookie request reads nothing — silently.** The MCP endpoint authenticates with a bearer token and the cron drain with a secret; there `createClient()` from `@/lib/supabase/server` is anonymous. `getUserApiKeys(userId)` then found no profile and fell back to the server's Google key (until v1.41.0), and `trackUsage(userId, sku)` only worked because `increment_api_usage` is executable by anon. Pass the caller's client: `getUserApiKeys(userId, ctx.supabase)`, `trackUsage(userId, sku, client)`. The last such call, the drain's review stage, passes `admin` since v1.43.0; since `rpc_least_privilege` (applied 19.11.2026) `anon` can't execute the function, and a missed call loses its count silently (`trackUsage` swallows errors).
- **`update … where id in (select … order by … limit …) returning *` does not return rows in the subquery's order.** `claim_import_items` selects by stage priority but hands rows back in update order; the drain sorts them again (v1.41.0 — before, a new place's import waited 87 s behind reviews from the same claim).
- **A queue job born `running` before its items exist can be closed under them.** The drain's `finalizeJobs` marks every running job without active items `done`, and the claim only takes items of running jobs. Create the job `preparing` (or Instagram's `reading`), write the items, then set `running` (v1.41.0: Takeout and assistant jobs).
- **`on delete set null` hides what was deleted.** `import_job_items.place_id` becomes null when its place is deleted, so "items whose place is gone" can't be found by joining — the item just looks like it never had one (an October Instagram job's five "Already exists" rows, 18.11.2026). Judge such history by what exists now.
- **One place per Google place is a database rule** (`places_user_google_place_id_key`, v1.41.0). A new place writer checks first and treats 23505 (`isUniqueViolation` in `src/lib/db/errors.ts`) as "already saved", like `importPlace`, `POST /api/places` and the shared-save route.
- **Migrations are SQL files in `supabase/migrations/`** (since 18.11.2026; the 56 before that exist only in the Supabase project), applied through Supabase MCP under the same name — see [[common-tasks]]. There's no Prisma: don't `prisma migrate dev`.

## Tailwind v4

- **No `tailwind.config.js`.** Config is CSS-side in `src/app/globals.css` via `@theme`. Adding a new color/token means editing the `@theme` block, not a JS config.
- **CSS variables are first-class.** Tokens are `--color-foreground`, etc. Reference them in arbitrary classes via `text-[--color-foreground]` if needed.
- **`@apply` works but is discouraged** — prefer composing utilities inline or with `cva`.
- **A class used only by a file created since the dev server last compiled CSS can be missing in `next dev`** (seen 18.11.2026: `gap-x-2` in a new component rendered with no gap). The persistent Turbopack cache in `.next/dev` reuses the old stylesheet. Touch `src/app/globals.css` (or restart with the cache cleared) before judging a layout; `next build` compiles from scratch and is not affected.

## State management

- **`const { data = [] } = useQuery(...)` makes a new array on every render while loading.** Fed into a `useEffect` dependency that sets state, it loops ("Maximum update depth exceeded" — seen 18.11.2026 on the list page). Use a module-level empty constant, or don't copy query data into state at all.
- **`mutate(vars, { onSuccess })` callbacks don't run once the component that called it unmounts.** A delete that sets the cached item to `null` makes the page render "not found" and unmounts the dialog first — the redirect and toast in those callbacks never happen (plans and lists, until v1.40.0). Use `await mutation.mutateAsync(vars)` and act after it; the hook's own `onSuccess` still runs.
- **Optimistic writes in a queue:** when writes to one resource share a mutation `scope`, write the server's answer into the cache only for the last one (`queryClient.isMutating({ mutationKey }) <= 1` inside `onSuccess` — the running mutation still counts), or an earlier answer undoes the later optimistic state on screen (`useChangeList`).

- **Don't reach for Context** for shared state. Use Zustand (existing pattern) or TanStack Query (existing pattern).
- **Don't mix server state into Zustand.** Server-cached data belongs in React Query. Zustand is for UI/transient state.

## Encryption & secrets

- `ENCRYPTION_SECRET` is server-only. Never log it, never expose to the client, never commit to git.
- Encrypted columns (`google_api_key_enc`, `mapbox_token_enc`) — only decrypt server-side.
- Never propose `console.log(process.env.ENCRYPTION_SECRET)` even in a debug context.

## Google Maps through DataForSEO

- **The Maps search needs a point, and ranks by it.** A world-scale viewport returns no items; a viewport around the wrong part of a city hides the right place (measured 18.11.2026: "Kaptanın Yeri, Konutkent Çarşısı" was missed from Çankaya's centre, found from Ankara's at 30 km). Search a query without its own coordinate across its city (`src/lib/instagram/places.ts`).
- **"No results" is task status 40102, not a failure** — for the Maps search and for business info. Treat it as an empty answer; a thrown error took down two eval posts.
- **An area query answers with the area:** one item, no `category`, sized by `address_info`. Businesses always have a category. Mapbox is fine for a city's centre but not for Istanbul neighbourhoods (it returns same-named streets elsewhere).
- **Richer results surface near-namesakes.** DataForSEO returned "Walker's Moda" where Google hadn't; a branch hint that only matches a street name plus a fuzzy name ("Walker's" ≈ "Walter's", 0.84) is not evidence (`hintOnly` in `resolve.ts`). Re-run `npm run eval:instagram` after any change to the search or the rules — precision is the contract.

## Assistant tools (MCP)

- **zod objects drop unknown keys silently.** A model that writes `date` for `visited_on` or `time` for `start_time` would get a call that ignores the field (a visit logged today, a stop without its time). Tool inputs are strict at the top (`defineTool` in `src/lib/assistant/tools/types.ts`) and the plan schemas are `z.strictObject` all the way down; keep new schemas strict, and name output fields as the input names them, so what the model reads it can write back.
- **"Today" on the server is not the user's today.** Vercel runs in UTC — a day ahead during a New York evening, a day behind on an Istanbul night. Plans and visits are judged by the date where they take place (`todayAt(place tz)` in `src/lib/plans/dates.ts`); the in-app chat by the browser's zone (sent in the request body). Client components use the browser's date already.

## URLs and redirects

- **Check a path after parsing, not only before.** `new URL()` collapses dot segments: `/.//evil.com`, `/%2e//evil.com` and `/a/..//evil.com` all become `//evil.com`, a protocol-relative URL to another host. `safeNextPath` (`src/lib/auth/safe-next.ts`) checks the parsed path too (v1.39.0; the raw-only check was an open redirect).

## Imports

- Don't add `import 'server-only'` to a file the client also needs. The build will fail loudly. Use the alias-and-split pattern if a module has both faces.
- Don't import `next/server` types in a client component — they don't ship to the browser.

## Mapbox

- `NEXT_PUBLIC_MAPBOX_TOKEN` is public by design — restricted by URL on the Mapbox side. Don't treat it as a secret.
- Map components must be client components (`"use client"`) — they touch `window`.

## PWA / offline

- **On localhost the service worker serves `/_next/static` stale-while-revalidate.** Dev chunk names don't change with their content, so the first load after a code change can run the OLD JavaScript (a fixed bug "still there", a new prop missing) — reload once more, or unregister the worker for localhost. Production chunk names are content-hashed, so this is a dev-only trap (seen 18.11.2026 on the shared list page).

- Service worker registration lives in `src/components/sw-register.tsx`. Don't move it. Don't duplicate the registration.
- `/offline` route is the fallback. Anything that has to work offline must be cached deliberately.

## Docs

- **Never put `version` or `last_updated` in a filename.** Wiki-links break on rename. Frontmatter only.
- **Never delete an archived doc.** Move to `_archive/`, set `status: superseded`.
