---
title: Integrations
type: overview
domain: integrations
version: 1.7.1
last_updated: 25.11.2026
status: stable
related:
  - "[[supabase]]"
  - "[[mapbox]]"
  - "[[google-places]]"
  - "[[dataforseo]]"
  - "[[gemini]]"
  - "[[hikerapi]]"
  - "[[claude-mcp]]"
  - "[[s2-geometry]]"
  - "[[react-query]]"
  - "[[zustand]]"
  - "[[../00-overview/tech-stack]]"
---

# Integrations

Third-party services and runtime libraries that materially shape how this app works. Distinct from `tech-stack` (which lists everything) — this folder is for dependencies whose **architecture or contracts** matter.

## External services

| Service | What we use it for | Doc |
|---|---|---|
| **Supabase** | Postgres + Auth + Storage (+ Vault, MCP, migrations) | [[supabase]] |
| **Mapbox** | Map rendering (GL JS) + Directions API for plan routes | [[mapbox]] |
| **Google Places API** | Not called since v1.42.0 — every place lookup goes through DataForSEO | [[google-places]] |
| **DataForSEO** (Business Data + Google Maps SERP) | Every place lookup: link previews, imports, enrichment, the Instagram import's search, Claude's Google Maps search (no per-user key) | [[dataforseo]] |
| **Google Gemini** (Generative Language API) | AI feature provider — `gemini-3-flash-preview`: Phase 6 NL search (Compare and AI Plan went to the assistant in v1.52.0 and v1.53.0). Wrote the full place_profile (Phase 4) and read Instagram posts (v1.28.0) until v1.51.0 — both Claude now | [[gemini]] |
| **Claude (MCP connector)** | The user's library as an MCP server for claude.ai and Claude Code; Supabase Auth is the OAuth 2.1 server (17.11.2026) | [[claude-mcp]] |
| **Claude API (platform agent)** | The platform's own Claude: the in-app assistant (v1.48.0) — called by our server with the same tools, conversations kept append-only — and, since v1.51.0, place profiles (Sonnet 5.5) and Instagram reads (Haiku 5.5); every call's dollars in one ledger against a $100 monthly cap. On `feat/personal-assistant` | [[claude-agent]] |
| **HikerAPI** | Instagram data — the post, its tagged/mentioned accounts and their profiles, for the Instagram import (v1.28.0). System-level key `HIKERAPI_KEY` | [[hikerapi]] |

## Runtime libraries (architecturally significant)

| Library | Role | Doc |
|---|---|---|
| **TanStack React Query** | Server-state cache + mutations | [[react-query]] |
| **Zustand** | Client-state stores (cross-page) | [[zustand]] |
| **S2 Geometry** | Decode Google Maps FTids → lat/lng (fallback) | [[s2-geometry]] |
| **AI SDK v6** (`ai`) + `@ai-sdk/google` | Model-agnostic call layer + Gemini provider — `generateText({ output: Output.object(...) })` for structured JSON | [[gemini]] |

Everything else (Tailwind, shadcn, lucide, sonner, …) is documented in [[../00-overview/tech-stack]].

## Provider preference (place enrichment)

Every place lookup goes through **DataForSEO** on the server's credentials (v1.42.0): parsing a Google Maps link, imports, enrichment, the Instagram import's candidate search (its Google Maps search, with Mapbox for the post's city), Claude's `search_google_maps` and `add_places`. Until v1.42.0 a user with a Google key and `profiles.google_places_enabled` went to Google Places first, and the Instagram import always used Google Text Search on the user's key — replaced because Text Search bills $35 per 1,000 past 1,000 free a month. See [[google-places]] and [[../05-flows/instagram-import-flow]].

## Cost-tracked SKUs

Every external API call that costs money goes through one of two trackers, both writing to the same `api_usage` table via `increment_api_usage` RPC:

- **`trackUsage`** in `src/lib/google/track-usage.ts` — for Google, DataForSEO, Mapbox (search sessions, Directions) and HikerAPI.
- **`trackAiUsage`** in `src/lib/ai/track-usage.ts` — for AI/LLM calls.

SKUs — the keys of `SKU_CONFIG` and `AI_SKU_CONFIG`; the canonical list with prices is [[../02-backend/schema/api_usage]]:

- Google Places: `text_search_pro`, `place_details_pro`, `reviews_enterprise`, `photos`, `text_search_enterprise` — none written since v1.42.0; kept so past rows still show.
- DataForSEO: `dataforseo_business_info_live`, `dataforseo_reviews`, `dataforseo_maps_search` (Claude's Google Maps search; since v1.42.0 also the Instagram import's).
- Mapbox: `mapbox_search_session`, `mapbox_directions` (v1.22.0); `mapbox_load` is registered but nothing tracks map loads.
- HikerAPI: `hikerapi_request` (v1.28.0).
- AI: `ai_place_profile`, `ai_parse_query`, `ai_rank_results`, `ai_compare`, `ai_chat`, `ai_trip_plan`, `ai_instagram_read` (v1.28.0), plus the unused `ai_embedding` placeholder. Since v1.51.0 profiles and Instagram reads are Claude calls in the Claude ledger (`assistant_spend`), not these SKUs — [[claude-agent]].

Map tile loads are not counted — Mapbox shows them on its own dashboard.

## Adding a new integration

See [[../_agent/common-tasks#add-a-new-integration-third-party-service]].
