---
title: Glossary
type: overview
domain: overview
version: 1.1.0
last_updated: 18.05.2026
status: stable
related:
  - "[[system-overview]]"
  - "[[../01-domain/places]]"
  - "[[../01-domain/trips]]"
  - "[[../01-domain/lists]]"
  - "[[../01-domain/sharing]]"
  - "[[../01-domain/users-and-profiles]]"
  - "[[../01-domain/categories-and-tags]]"
  - "[[../01-domain/geo-and-s2]]"
---

# Glossary

Single source of truth for every domain term, abbreviation, and acronym used in this codebase. When in doubt, link to the entry rather than redefining inline.

## Domain entities

| Term | Meaning |
|---|---|
| **Place** | A single saved location (restaurant, museum, hotel…). Has coords, name, address, category, optional sub-category, tags, rich Google/DataForSEO/AI data, visit status. See [[../01-domain/places]]. |
| **Category** | A single classification a Place can belong to (1:1 optional). 12 defaults seeded on signup. See [[../01-domain/categories-and-tags]]. |
| **Sub-category** | An optional granular classification under a parent Category (e.g. *Cocktail Bar* under *Bar & Nightlife*). Per-user, ~62 defaults seeded on signup, AI can propose new ones via moderation queue. See [[../02-backend/schema/subcategories]]. |
| **Tag** | A free-form label attached to a Place (M:N). User-created. See [[../01-domain/categories-and-tags]]. |
| **List** | A named, ordered grouping of Places. Many-to-many with Places via `list_places`. See [[../01-domain/lists]]. |
| **Trip** | A date-ranged plan made up of Trip Days, each holding ordered Places. Often linked to a source List. See [[../01-domain/trips]]. |
| **Trip Day** | One date within a Trip; carries a `day_number` and ordered `trip_day_places`. |
| **Trip Day Place** | A Place placement within a Trip Day, with `sort_order` and optional `time_slot`. |
| **Shared Link** | A public-readable slug URL pointing to a List or Trip. See [[../01-domain/sharing]]. |
| **Profile** | The per-user row in `public.profiles` (1:1 with `auth.users`). Holds display name, encrypted API keys, feature flags. See [[../01-domain/users-and-profiles]]. |
| **Visit Status** | One of `want_to_go` / `booked` / `visited` / `favorite`. Drives filtering and marker style. |

## Subsystems

| Term | Meaning |
|---|---|
| **Auto-plan** | The trip-day distribution algorithm: K-means++ clustering by lat/lng → category ordering → nearest-neighbor routing. Lives in `src/lib/trip/auto-plan.ts`. |
| **Enrichment** | Fetching rich data (rating, photos, opening hours, reviews) for a Place from Google Places API or DataForSEO. Stored in `places.google_data` (jsonb). |
| **Batch import** | The client-driven flow that parses a Google Takeout file, then loops `POST /api/places/import-batch` in chunks of 3. Progress tracked in [[../03-frontend/stores/import-store]]. |
| **Share target** | The PWA `share_target` declaration in `src/app/manifest.ts` that lets mobile browsers send `url`/`text`/`title` to `/api/share-target`. |

## AI

| Term | Meaning |
|---|---|
| **Place Profile** | The pivot AI data layer attached to each place at `places.google_data.place_profile` (jsonb). Two completeness levels: **lite** (rule-based, produced inline by `parse-link` — no LLM) and **full** (Gemini Flash output produced by `step=profile` background pipeline). Schema: `src/lib/ai/schemas/place-profile.ts`. See [[../05-flows/lite-profile-flow]], [[../05-flows/full-profile-flow]]. |
| **Lite path** | The synchronous, LLM-less branch of AI features. Runs in `parse-link` route via `buildLiteProfile()`. Used to surface AI chips in the Add Place dialog. |
| **Full path** | The Gemini-powered branch. Runs in background after place save via `enrich?step=profile`. Writes the full place_profile + applies suggestions via the moderation queue. |
| **AI master toggle** | `profiles.ai_features_enabled boolean` — per-user kill switch. When false, every AI route short-circuits and AI UI is hidden. Surfaced as Settings → AI tab toggle. |
| **AI Suggestions queue** | `public.ai_suggestions_queue` table. Holds pending tag / sub-category / category-change proposals the LLM produced but couldn't auto-apply silently. Phase 5 moderation UI consumes it. |
| **4-band auto-apply** | The policy in `src/lib/ai/apply-suggestions.ts`: silent apply / queue / category-change-queue / ignore — by confidence × existing-entity match × parent-mismatch. See [[../05-flows/full-profile-flow#auto-apply-policy-4-band]]. |
| **Category change proposal** | A queue entry where the LLM disagrees with the rule-based parent-category assignment from save time (Phase 5.5). Accept atomically moves the place to the new parent (and nulls out the now-invalid subcategory_id). |
| **AI SKU** | Per-call usage counter in `public.api_usage` under `sku` prefixed `ai_*` (e.g. `ai_place_profile`). Powers the Settings → API & Usage cost tracker for AI calls. |
| **Gemini Flash** | The default LLM provider — `gemini-flash-latest` via `@ai-sdk/google`. Key: `GOOGLE_GENERATIVE_AI_API_KEY`. See [[../04-integrations/gemini]]. |

## Geo

| Term | Meaning |
|---|---|
| **PostGIS** | Postgres extension providing geography types and spatial indexes. `places.location` is `geography(Point)`. |
| **Geography vs geometry** | PostGIS distinguishes spheroidal `geography` (Earth-correct) from planar `geometry`. This repo uses `geography`. |
| **EWKB** | Extended Well-Known Binary. The default wire format Supabase returns geography values as (hex string in JSON). Parsed by `src/lib/geo.ts#parsePostgisPoint`. |
| **WKT** | Well-Known Text, e.g. `POINT(lng lat)`. Also parsed by `parsePostgisPoint` as a fallback. |
| **GIST index** | The spatial index type used on `places.location`. Supports `ST_DWithin` and friends. |
| **S2 cell** | A hierarchical spatial cell ID from Google's S2 geometry library. Used here only to decode the FTid embedded in Google Maps URLs into approximate lat/lng. See [[../01-domain/geo-and-s2]]. |
| **FTid** | "FeatureID" — the `0x...:0x...` hex pair in Google Maps URLs. The first hex is an S2 cell ID; the second is a feature index. |

## Auth & security

| Term | Meaning |
|---|---|
| **RLS** | Row-Level Security. Postgres policies that gate row visibility per role. Every user-owned table here has `auth.uid() = user_id` policies. |
| **Service role** | A Supabase API key that bypasses RLS. Used only by `createServiceClient()` in `src/lib/supabase/server.ts`, exclusively for serving public share content. Env: `SUPABASE_SERVICE_ROLE_KEY`. |
| **SSR auth** | `@supabase/ssr`'s cookie-based session, refreshed by middleware on every request. See [[../02-backend/auth]] when written. |
| **`auth.uid()`** | Postgres function exposed by Supabase Auth that returns the current authenticated user's UUID. Used in every RLS policy. |
| **SECURITY DEFINER** | Postgres function attribute making it run as the function owner instead of the caller. Custom DEFINER functions in this repo: `handle_new_user`, `create_default_categories`, `increment_api_usage`. |
| **Encrypted API keys** | User-provided API keys (Google, Mapbox, DataForSEO) are AES-256-GCM encrypted via `ENCRYPTION_SECRET` and stored in `profiles.*_enc` columns. Never logged, never returned to client. |

## Next.js / frontend

| Term | Meaning |
|---|---|
| **App Router** | Next.js's `app/`-directory routing (vs the legacy `pages/`). This repo uses App Router exclusively. |
| **Route group** | A folder wrapped in parens like `(app)` or `(auth)` — doesn't appear in URLs, exists only to share a layout. |
| **Server Component** | A React component that runs on the server only (default in `app/`). Can `await` directly. |
| **Client Component** | A React component marked `"use client"` at the top; runs in the browser. Required for state, effects, browser APIs. |
| **Route handler** | A `route.ts` file inside `src/app/api/` that exports `GET`/`POST`/etc. functions. |
| **Middleware** | `src/middleware.ts` — runs per request before any route resolves. This repo uses it to refresh the Supabase session and gate auth. |
| **`cn()`** | Class merger in `src/lib/utils.ts`. Combines `clsx` + `tailwind-merge`. |
| **shadcn** | A component CLI that copies primitive components into `src/components/ui/`. Not a runtime dependency — the code is yours after install. |
| **`base-nova`** | The shadcn style this repo uses (set in `components.json`). Built on `@base-ui/react` primitives. |

## State

| Term | Meaning |
|---|---|
| **React Query** | TanStack Query. Caches server state. Default `staleTime: 60s`. Configured in `src/lib/providers.tsx`. |
| **Query key** | The array that uniquely identifies a cached query. Convention: namespaced by entity, e.g. `["places", filters]`. |
| **Stale time** | How long a query stays "fresh" before refetching. 60s default here. |
| **Zustand store** | A small client-state store. Currently only one (`import-store`). |
| **Cache invalidation** | After a mutation, the affected query keys are invalidated so consumers refetch. Documented per route. |

## Misc

| Term | Meaning |
|---|---|
| **PWA** | Progressive Web App. This repo ships a manifest, service worker, offline route, and `share_target`. |
| **Service worker** | `public/sw.js` — registered by `src/components/sw-register.tsx`. Handles offline fallback. |
| **`api_usage` SKU** | A short string identifying which external API operation was billed (e.g. `google.text_search`, `dataforseo.business_info`). Tracked via `increment_api_usage()` RPC. |
| **Vault** | The Obsidian-style docs structure under `docs/`. See [[../README]]. |
| **Frontmatter** | The YAML block at the top of every vault doc. Schema: [[../_meta/frontmatter-schema]]. |
| **Wiki-link** | The `[[Target]]` syntax for cross-doc links inside the vault. |
