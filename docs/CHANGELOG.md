# CHANGELOG

A running log of every meaningful change to the vault: new docs, structural changes, content rewrites, schema updates. Entries are newest-first.

Format: `## DD.MM.YYYY — vX.Y.Z — short title` followed by bullets.

---

## 13.05.2026 — v1.1.0 — F-01 place search (Mapbox Search Box)

Shipped F-01 from `_archive/feature-suggestions_v3` (Manuel Mekan Ekleme, drop-pin scope dropped). Users can now search a place on `/map`, preview enriched details, and save to their places without leaving the page.

### Code

- **DB** — migration `add_source_check_with_mapbox_search` applied: `places.source` now has `CHECK (source IN ('manual','import','link','mapbox_search'))`.
- **Backend** — new `GET /api/search/suggest` and `GET /api/search/retrieve/[id]` (`src/app/api/search/...`) wrapping Mapbox Search Box. Retrieve auto-enriches via DataForSEO when env credentials present, mirroring the parse-link response shape.
- **Library** — `src/lib/mapbox/search-box.ts` (server-only): `suggest` + `retrieve` fetch wrappers.
- **Cost tracking** — new SKU `mapbox_search_session` ($11.50/1k, 500 free/month). Tracked on `retrieve` call.
- **Env** — new server-only `MAPBOX_SERVER_TOKEN` (URL-restriction off). Falls back to public token. Added to `.env.local.example`.
- **Types** — `Place.source` extended with `"mapbox_search"`.
- **Frontend hook** — `src/lib/hooks/use-place-search.ts` (`usePlaceSearch`): 300ms debounced suggest, UUIDv4 session token rotation (on retrieve / 180s idle / 50 suggests), retrieve mutation.
- **MapView extension** — new ref methods `flyToCoords({lng,lat,zoom})` and `getCenter()`; new prop `searchMarker?: {lng,lat,color?}` renders a transient `mapboxgl.Marker`.
- **New components** — `src/components/map/search-box.tsx` (overlay autocomplete pill) and `src/components/map/search-result-panel.tsx` (slide-in detail + Save form). Form reuses existing inline-category/list/tag creators and VisitStatusToggle.
- **MapContent integration** — search box sits beside the mobile filter button (top-left); search panel hides FAB / visible-place badge / empty-state CTA. Selecting a place closes any active search panel and vice versa.

### Docs

- New [[02-backend/api-routes/search]] — full per-route detail.
- New [[03-frontend/hooks/use-place-search]] — hook spec + session lifecycle.
- New [[05-flows/place-search-flow]] — end-to-end flow doc.
- Updated [[02-backend/api-routes/_README]] — added Search group.
- Updated [[02-backend/schema/places]] — `source` CHECK constraint documented; `source` enum drift moved out of Open questions.
- Updated [[02-backend/schema/api_usage]] — `mapbox_search_session` SKU registered.
- Updated [[03-frontend/hooks/_README]] — added `usePlaceSearch`.
- Updated [[03-frontend/components/map]] — MapView extended API; new SearchBox / SearchResultPanel sections.
- Updated [[04-integrations/mapbox]] — Search Box API section + standard pricing.
- Updated [[06-ops/env-vars]] — `MAPBOX_SERVER_TOKEN` added.

### Out of scope (deferred)

- Drop-pin / map-click to add place.
- Clickable POI labels (Mapbox Standard `addInteraction` or `queryRenderedFeatures` overlay).
- Proximity bias (`usePlaceSearch` accepts the opt; not wired through `SearchBox` yet).
- Per-user DataForSEO billing (server env still single-tenant).

---

## 12.05.2026 — v1.0.0 — Vault complete

The vault is now fully populated end-to-end. Foundation, anchor, backend, frontend, integrations, flows, and ops layers all written. Automation wired.

### `03-frontend/` (Phase 4 — 30 docs)

- [[03-frontend/_README]] — frontend overview.
- [[03-frontend/app-router-conventions]] — Next.js 16 App Router conventions used here.
- [[03-frontend/routing]] — every page + API route table.
- [[03-frontend/layouts]] — root, `(app)`, `(auth)`, shared layouts.
- [[03-frontend/state-management]] — React Query / Zustand / URL state / localStorage boundary.
- [[03-frontend/middleware]] — auth gate detail.
- [[03-frontend/pwa-and-offline]] — manifest, SW, offline page, share target.
- [[03-frontend/design-system/_README]] — tokens, shadcn `base-nova`, fonts, dark mode, marker icons, and the **runtime vs `master.md` divergence** flagged.
- `03-frontend/hooks/` — `_README` + 10 per-hook docs (useCategories, useDebounce, useFilters, useLists, useMapStyle, usePlaces, useSharedLinks, useStats, useTags, useTrips).
- `03-frontend/stores/` — `_README` + `import-store`.
- `03-frontend/components/` — `_README` + per-folder docs (filters, layout, map, places, settings, ui-shadcn, sw-register).

### `04-integrations/` (Phase 5 — 8 docs)

- [[04-integrations/_README]] — provider preference + cost-tracked SKUs.
- [[04-integrations/supabase]], [[04-integrations/mapbox]], [[04-integrations/google-places]], [[04-integrations/dataforseo]] — per-service deep dives.
- [[04-integrations/react-query]], [[04-integrations/zustand]], [[04-integrations/s2-geometry]] — architecturally significant libraries.

### `05-flows/` (Phase 6 — 8 docs)

- [[05-flows/_README]] — flow index.
- [[05-flows/auth-flow]] — OAuth + email/password sequence.
- [[05-flows/signup-flow]] — DB trigger cascade with verified default-category seeds.
- [[05-flows/place-import-flow]] — client-driven batched import.
- [[05-flows/manual-place-create-flow]] — paste-URL flow with provider switch.
- [[05-flows/trip-planning-flow]] — create → auto-plan → day mutations + Mapbox routes.
- [[05-flows/share-flow]] — slug creation → public read → save-to-account viral loop.
- [[05-flows/share-target-flow]] — PWA mobile-share-sheet inbound.
- [[05-flows/offline-flow]] — SW, banner, fallback page.

### `06-ops/` (Phase 7 — 5 docs + runbook index)

- [[06-ops/_README]] — production topology, what's missing.
- [[06-ops/deployment]] — Vercel pipeline, rollback procedure.
- [[06-ops/env-vars]] — every env var, where set, **flagged `.env.local.example` missing `SUPABASE_SERVICE_ROLE_KEY`**.
- [[06-ops/encryption]] — `ENCRYPTION_SECRET`, AES-256-GCM, rotation procedure.
- [[06-ops/monitoring]] — what's available, what's missing, useful SQL one-liners.
- [[06-ops/runbooks/_README]] — runbook index (currently empty; candidates listed).

### Archive cleanup

- Added frontmatter to all 10 `docs/_archive/*` files with `status: superseded` / `deprecated` and `superseded_by` wiki-links pointing to the new authoritative docs.

### Automation

- **`CLAUDE.md` updated** from `@AGENTS.md` only to reference the new vault entry points and the doc-update workflow.
- **PostToolUse hook** `.claude/hooks/post-edit-docs.sh` — after every Edit/Write to a source file, prints a list of vault docs whose `sources:` reference that file. Adds a reminder line about bumping `version` and updating CHANGELOG.
- **`.claude/settings.local.json`** — added the hooks block wiring the new hook to `Edit | Write | NotebookEdit`.
- **`/update-docs` skill** at `.claude/skills/update-docs.md` — walks the agent through identifying affected docs, proposing edits, bumping versions, and logging.

## 12.05.2026 — v0.3.0 — Backend deep dive (Supabase + API routes)

- Wrote [[02-backend/_README]] — backend layering, conventions, snapshot row counts.
- Wrote [[02-backend/supabase-clients]] — the four clients (browser, server, service-role, middleware) with use-when matrix.
- Wrote [[02-backend/auth]] — OAuth callback flow, middleware gate, server-side auth check, RLS link, advisor weak spots.
- Wrote [[02-backend/rls-policies]] — cross-table policy view, advisor findings, hardening SQL (not applied).
- Wrote [[02-backend/edge-functions]] — confirms none deployed; template for future additions.
- Wrote `02-backend/schema/`:
  - [[02-backend/schema/_README]] — table index, extensions, functions, triggers, storage, 28 migrations listed.
  - 11 per-table docs: [[02-backend/schema/profiles|profiles]], [[02-backend/schema/places|places]], [[02-backend/schema/categories|categories]], [[02-backend/schema/tags|tags]], [[02-backend/schema/place_tags|place_tags]], [[02-backend/schema/lists|lists]], [[02-backend/schema/list_places|list_places]], [[02-backend/schema/place_photos|place_photos]], [[02-backend/schema/api_usage|api_usage]], [[02-backend/schema/trips|trips]], [[02-backend/schema/trip_days|trip_days]], [[02-backend/schema/trip_day_places|trip_day_places]], [[02-backend/schema/shared_links|shared_links]]. Each with columns, indexes, RLS, FKs, consumers, open questions.
- Wrote `02-backend/api-routes/`:
  - [[02-backend/api-routes/_README]] — group index + cross-route conventions + helper library.
  - 8 group docs: [[02-backend/api-routes/places|places]] (11 endpoints), [[02-backend/api-routes/trips|trips]] (8 endpoints), [[02-backend/api-routes/lists|lists]] (1 endpoint + RLS-as-API note), [[02-backend/api-routes/shared|shared]] (4 endpoints incl. public GET), [[02-backend/api-routes/stats|stats]] (1 endpoint + missing-RPC note), [[02-backend/api-routes/user|user]] (3 endpoints), [[02-backend/api-routes/share-target|share-target]] (PWA public POST), [[02-backend/api-routes/auth-callback|auth-callback]] (OAuth exchange).
- Confirmed via Supabase MCP `execute_sql`: the `get_visit_status_counts` RPC the stats route attempts to call **does not exist** — fallback path is the active one.

## 12.05.2026 — v0.2.0 — Overview + domain anchor layer

- Wrote [[00-overview/system-overview]] — architecture diagram, subsystem map, cross-cutting concerns, known sharp edges. Built from a Supabase MCP live inspection + archived v2 docs + source-file reads.
- Wrote [[00-overview/tech-stack]] — dep-by-dep breakdown with versions, roles, and the "not in stack" list.
- Wrote [[00-overview/repo-structure]] — full folder map for `src/`, `public/`, `.claude/`, `.github/`, and counts.
- Wrote [[00-overview/glossary]] — domain entities, subsystems, geo terms, auth/security terms, frontend/state terms.
- Wrote `01-domain/`:
  - [[01-domain/places]] — Place entity with full column shape, `google_data` jsonb breakdown, lifecycle, every `/api/places/*` route, cascade-delete behavior.
  - [[01-domain/trips]] — covers `trips` + `trip_days` + `trip_day_places`, auto-plan algorithm, Mapbox Directions cost model.
  - [[01-domain/lists]] — List entity + `list_places` junction, reorder transaction note.
  - [[01-domain/sharing]] — Shared Link with public-vs-service-role policy split, save-to-account viral loop.
  - [[01-domain/users-and-profiles]] — Profile shape, signup trigger cascade (`handle_new_user` → `create_default_categories`), encrypted API keys, `api_usage` RPC.
  - [[01-domain/categories-and-tags]] — 12 default categories with verified colors/icons (from `create_default_categories()` source), tag M:N junction.
  - [[01-domain/geo-and-s2]] — PostGIS wire formats, `parsePostgisPoint` parser, S2 FTid decode fallback, `(0,0)` sentinel.

## 12.05.2026 — v0.1.0 — Vault scaffolded

- Created folder skeleton: `_agent/`, `_meta/`, `_archive/`, `00-overview/`, `01-domain/`, `02-backend/`, `03-frontend/`, `04-integrations/`, `05-flows/`, `06-ops/`.
- Moved root `design-system/map-organiser/MASTER.md` → `docs/03-frontend/design-system/master.md`. Removed empty root `design-system/`.
- Archived existing top-level docs (v1/v2 of system, system-design, design-system, feature-suggestions, test-plan + dataforseo analysis) under `_archive/`. Content will be redistributed into the new structure in a later pass.
- Wrote vault foundation:
  - [[README]]
  - [[_meta/vault-guide]]
  - [[_meta/frontmatter-schema]]
  - Templates in `_meta/templates/`
  - [[_agent/conventions]]
  - [[_agent/common-tasks]]
  - [[_agent/pitfalls]]
  - [[_agent/claude-md-source]]
  - [[_archive/_README]]
