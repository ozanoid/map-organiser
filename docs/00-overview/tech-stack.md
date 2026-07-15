---
title: Tech Stack
type: overview
domain: overview
version: 1.3.0
last_updated: 15.07.2026
status: stable
sources:
  - package.json
  - components.json
  - next.config.ts
  - tsconfig.json
  - eslint.config.mjs
  - postcss.config.mjs
related:
  - "[[system-overview]]"
  - "[[repo-structure]]"
  - "[[../_agent/conventions]]"
  - "[[../_agent/pitfalls]]"
---

# Tech Stack

Every runtime, library, and tool the repo currently depends on. Pin sources are `package.json` + the named config files in `sources:`. Versions reflect what's in lockfile-controlled `package.json` ranges as of `last_updated`.

## Framework & runtime

| Lib | Version | Role | Notes |
|---|---|---|---|
| `next` | `16.2.10` | App Router framework | App Router only; no Pages. See [[../_agent/pitfalls#next-js-16]]. |
| `react` | `19.2.7` | UI library | Server Components default. |
| `react-dom` | `19.2.7` | DOM renderer | — |
| `typescript` | `^6` | Type system | `strict: true`. Path alias `@/*` → `src/*`. |
| `eslint` | `^10` | Linter | Extends `eslint-config-next` core-web-vitals + typescript. `settings.react.version` pinned in `eslint.config.mjs` (ESLint-10 compat — the bundled `eslint-plugin-react` uses the removed `getFilename()`). Some strict rules `warn`-deferred — see v4 PART 4 #12. |
| `eslint-config-next` | `16.2.10` | Lint preset | Tracked with Next.js version. Pulls `eslint-plugin-react-hooks@7` (React-Compiler rules). |

## UI

| Lib | Version | Role | Notes |
|---|---|---|---|
| `tailwindcss` | `^4` | CSS framework | v4 — config is CSS-side via `@theme` in `src/app/globals.css`. No `tailwind.config.js`. |
| `@tailwindcss/postcss` | `^4` | PostCSS plugin | Wired in `postcss.config.mjs`. |
| `tw-animate-css` | `^1.4.0` | Animation utilities | — |
| `class-variance-authority` | `^0.7.1` | Variant builder | Preferred over inline conditionals for component variants. |
| `clsx` | `^2.1.1` | Class merging | Used inside `cn()` in `src/lib/utils.ts`. |
| `tailwind-merge` | `^3.6.0` | Tailwind class dedup | Also inside `cn()`. |
| `shadcn` | `^4.13.0` | Component CLI | Style `base-nova` (see `components.json`). Components install to `src/components/ui/`. |
| `@base-ui/react` | `^1.6.0` | Headless primitives | Underlying primitives for shadcn `base-nova` style. |
| `lucide-react` | `^1.23.0` | Icon library | Set in `components.json`. |
| `cmdk` | `^1.1.1` | Command menu | — |
| `sonner` | `^2.0.7` | Toast notifications | — |
| `next-themes` | `^0.4.6` | Light/dark/system theme | Wired in `src/lib/providers.tsx`, attribute=`class`. |

## Data

| Lib | Version | Role | Notes |
|---|---|---|---|
| `@supabase/supabase-js` | `^2.103.0` | Postgres + Auth + Storage client | Used by `createServiceClient` in `src/lib/supabase/server.ts`. |
| `@supabase/ssr` | `^0.12.0` | SSR cookie auth | Powers all three clients (browser/server/middleware) in `src/lib/supabase/`. |
| `@tanstack/react-query` | `^5.101.2` | Server-state cache | Default `staleTime: 60_000`, `refetchOnWindowFocus: false`. |
| `zustand` | `^5.0.14` | Client state store | Currently only `src/lib/stores/import-store.ts`. |
| `zod` | `^4.4.3` | Runtime validation | Used on every mutation API route + every AI structured output. |

## AI

| Lib | Version | Role | Notes |
|---|---|---|---|
| `ai` | `^6.0.184` | AI SDK v6 — model-agnostic call layer (`generateText` + `Output.object`) | Used by Phase 4 `step=profile` enrich branch. Direct provider wiring (not AI Gateway) — see [[../04-integrations/gemini]] for the explicit choice. |
| `@ai-sdk/google` | `^3.0.75` | Google provider for AI SDK | `createGoogleGenerativeAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY })`. Model: `gemini-3-flash-preview` (since 15.07.2026). |

## Observability

| Lib | Version | Role | Notes |
|---|---|---|---|
| `@vercel/otel` | `^2.1.3` | OTel SDK bootstrap (`registerOTel`) | `src/instrumentation-node.ts`. Traces → Honeycomb; auto HTTP + fetch spans. |
| `@opentelemetry/api` | `^1.9.1` | OTel API surface | Logger/tracer access (`src/lib/telemetry/logger.ts`). |
| `@opentelemetry/sdk-logs` | `^0.220.0` | OTel log pipeline | `BatchLogRecordProcessor` (≥0.220: options-object ctor). |
| `@opentelemetry/exporter-logs-otlp-http` | `^0.220.0` | OTLP log exporter | → Honeycomb `/v1/logs`. |
| `@langfuse/otel` | `^5.9.1` | Langfuse span processor | `src/lib/telemetry/langfuse.ts` — LLM-only span export to cloud.langfuse.com (v1.16.0). |
| `@langfuse/tracing` | `^5.9.1` | Langfuse trace helpers | `propagateAttributes` (trace name/user/tags) in the four routes that trigger LLM calls (parse-query, rank-results, enrich, refresh cron). |

See [[../05-flows/observability-flow]] for the full architecture.

## Maps & geo

| Lib | Version | Role | Notes |
|---|---|---|---|
| `mapbox-gl` | `^3.25.0` | Map rendering | Plus Directions API for trip route lines. Token in `NEXT_PUBLIC_MAPBOX_TOKEN`. |
| `@types/mapbox-gl` | `^3.5.0` | Types | — |
| `@types/geojson` | `^7946.0.16` | GeoJSON types | Declared explicitly (v1.15.0): the mapbox bump dropped it as a transitive dep, breaking the `GeoJSON` namespace in `map-view.tsx`. |
| `s2-geometry` | `^1.2.10` | S2 cell decoding | Used **only** in `src/lib/google/parse-maps-url.ts` to decode the FTid in Google Maps URLs. See [[../01-domain/geo-and-s2]]. |

## Drag & drop

| Lib | Version | Role |
|---|---|---|
| `@dnd-kit/core` | `^6.3.1` | Core primitives |
| `@dnd-kit/sortable` | `^10.0.0` | Sortable lists (list reorder, trip day reorder) |
| `@dnd-kit/utilities` | `^3.2.2` | Helpers |

## Charts & dates

| Lib | Version | Role |
|---|---|---|
| `recharts` | `^3.9.2` | Stats dashboard charts |
| `date-fns` | `^4.4.0` | Date formatting |

## External integrations (not npm packages)

- **Supabase** project `hukppmaevcapvbrvxtph` — eu-central-1, Pro plan, PostGIS enabled. Schema is dashboard/MCP-managed; no local `supabase/migrations/` folder. See [[../02-backend/_README]] when written.
- **Mapbox** — GL JS map + Directions API. Free tier: 100K directions requests/month.
- **Google Places API** — server-only via `GOOGLE_PLACES_API_KEY`. Per-user opt-in via `profiles.google_places_enabled`.
- **DataForSEO Business Data API** — default enrichment provider. HTTP basic auth via `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`.
- **Google Gemini** (via Generative Language API) — Phase 4+ AI feature provider. Model: `gemini-3-flash-preview` (since 15.07.2026). Key: `GOOGLE_GENERATIVE_AI_API_KEY` (server-only). Cost-tracked via `api_usage` table under SKUs `ai_*`. See [[../04-integrations/gemini]].
- **Vercel** — hosting platform. CLI permission granted in `.claude/settings.local.json`.

See [[../04-integrations/_README]] (when written) for per-service deep-dives.

## Runtime targets

- **Node.js** — Vercel default (Node 24 LTS at time of last archived doc; will follow Vercel's current default). All API routes are Node-compatible (no edge-specific code observed beyond middleware).
- **Middleware** — runs as Vercel Function (Fluid Compute). See `src/middleware.ts` matcher.
- **Browser baseline** — modern browsers via Next.js + React 19. No explicit browserslist override; Tailwind v4 + Next.js defaults apply.

## Things NOT in the stack (despite being adjacent)

These are common adjacent picks that this repo deliberately doesn't use:

- **No ORM.** Direct `@supabase/supabase-js` queries.
- **No Prisma.** Schema lives in the dashboard.
- **No Redux / Jotai.** Zustand for client state, React Query for server state.
- **No Auth.js / NextAuth.** Supabase Auth via `@supabase/ssr` cookie-based session.
- **No CSS-in-JS.** Tailwind utilities only.
- **No test runner.** No Jest / Vitest / Playwright at the moment.
- **No Prettier.** ESLint only.

## Lockfile & install

- `package-lock.json` is committed (npm).
- Scripts: `dev`, `build`, `start`, `lint` — that's it.

## Versioning behavior

- Dependabot is configured (`.github/workflows/dependabot.yml`) for **weekly npm minor/patch** updates only — major upgrades are manual.
- Next.js and `eslint-config-next` versions move together (lock-step pin).
