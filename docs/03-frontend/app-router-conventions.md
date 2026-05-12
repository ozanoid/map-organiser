---
title: App Router Conventions
type: overview
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/
related:
  - "[[_README]]"
  - "[[routing]]"
  - "[[layouts]]"
  - "[[../_agent/conventions]]"
  - "[[../_agent/pitfalls#next-js-16]]"
---

# App Router Conventions

How this repo uses Next.js 16's App Router. Foundational reading for anyone touching `src/app/`.

## File conventions used

| Filename | Role | Used here |
|---|---|---|
| `layout.tsx` | Wraps a route segment | Root, `(app)`, `(auth)`, `shared` |
| `page.tsx` | Renders a route | 12 routes (see [[routing]]) |
| `route.ts` | API route handler | ~24 handlers under `app/api/` + `app/auth/callback/` |
| `manifest.ts` | PWA manifest | `src/app/manifest.ts` (a route, not a JSON file) |
| `loading.tsx` | Loading UI | **Not used yet** |
| `error.tsx` | Error boundary | **Not used yet** |
| `not-found.tsx` | 404 UI | **Not used yet** |
| `globals.css` | Global styles | `src/app/globals.css` (imported by root layout) |

## Route groups

Folders wrapped in parens (`(app)`, `(auth)`) do **not** appear in URLs — they exist to share a layout without nesting paths.

```
src/app/
├── (app)/        ← all routes here are /{name}, not /(app)/{name}
│   ├── layout.tsx   ← shared sidebar + header for authenticated UI
│   ├── map/
│   ├── places/
│   ├── lists/
│   ├── trips/
│   ├── stats/
│   ├── import/
│   └── settings/
├── (auth)/       ← /login, /signup
│   ├── layout.tsx   ← minimal centered layout
│   ├── login/
│   └── signup/
└── shared/       ← /shared/<slug> (NOT a group — visible in URL)
    └── layout.tsx
```

## Server vs client components

**Default: Server Component.** Every page and component without `"use client"` runs on the server.

When to mark `"use client"` at the top:

- Browser-only APIs (`window`, `localStorage`).
- React hooks (`useState`, `useEffect`, etc.).
- Event handlers (`onClick`, `onChange`).
- Subscriptions (Supabase realtime, theme).

**Push `"use client"` to leaves.** A `page.tsx` that needs interactivity should usually stay a Server Component and embed a Client Component child. Why? Server Components let you `await` data directly and don't ship code to the browser.

Pattern observed in this repo:

- `page.tsx` files in `(app)/` are mostly Client Components today because they own filter state and React Query hooks. That's pragmatic but means more JS in the browser. A future migration to keep the page server-side with a `<ClientShell>` child is worth considering.

## Async server components

```tsx
// Allowed:
export default async function Page() {
  const data = await fetchSomething();
  return <div>{data.name}</div>;
}
```

Client Components can't be async. If you mark a function `"use client"`, you cannot `await` directly in its body — use a hook or get the data via React Query.

## Route handlers

`src/app/api/.../route.ts` exports `GET`, `POST`, `PATCH`, `DELETE`, etc.:

```ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;            // ⚠ Next.js 16: params is a Promise
  // ...
}
```

**Next.js 16 quirk:** `params` and `searchParams` are now Promises in route handlers and pages. Always `await` them — TypeScript will yell if you don't.

## Metadata

Page-level metadata is exported as `metadata` from `layout.tsx` or `page.tsx`:

```ts
export const metadata: Metadata = {
  title: "Map Organiser",
  description: "...",
};
```

No `_document.tsx` exists in App Router — `<head>` content lives in layouts or page metadata.

## Streaming and Suspense

Not currently used. No `<Suspense>` boundaries are wired. If a future page does heavy server-side work, wrapping the slow piece in `<Suspense fallback={...}>` is the App Router way.

## Dynamic vs static rendering

Default in App Router is static rendering. A page becomes dynamic if it:

- Uses cookies (via `next/headers`).
- Reads `searchParams`.
- Calls `fetch` with `cache: 'no-store'`.

Most `(app)/*` pages in this repo are dynamic because they read the Supabase session via cookies (in a server component or via middleware).

No `export const dynamic = "force-dynamic"` or similar is used today.

## Middleware vs route handlers

| Concept | Lives at | Runs when |
|---|---|---|
| Middleware | `src/middleware.ts` | Before route resolution, on every matched path |
| Route handler | `src/app/api/.../route.ts` | After resolution, only for that path |

The middleware here delegates to `updateSession()` from `src/lib/supabase/middleware.ts`. See [[middleware]].

## Path conventions

- **`@/*` alias** → `./src/*`. Use it for everything.
- **No deep relative paths.** `../../../components/Foo` is a smell; use `@/components/Foo`.
- **Route folders are kebab-case** (`api/share-target`, `api/places/import-batch`).

## Things to avoid

- **Don't suggest `getServerSideProps`/`getStaticProps`** — that's Pages Router.
- **Don't suggest `next/router`** — use `next/navigation` (App Router).
- **Don't add `"use server"` to a file as a workaround.** Server Actions have their own contract.
- **Don't use `pages/`** at all. The folder doesn't exist; if you create it, you'll confuse the build.

See [[../_agent/pitfalls#next-js-16]] for the canonical list.
