---
title: Integrations
type: overview
domain: integrations
version: 1.3.0
last_updated: 16.10.2026
status: stable
related:
  - "[[supabase]]"
  - "[[mapbox]]"
  - "[[google-places]]"
  - "[[dataforseo]]"
  - "[[gemini]]"
  - "[[hikerapi]]"
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
| **Mapbox** | Map rendering (GL JS) + Directions API for trip routes | [[mapbox]] |
| **Google Places API** | Authoritative place data when the user provides a key | [[google-places]] |
| **DataForSEO Business Data** | Default enrichment provider (no per-user key) | [[dataforseo]] |
| **Google Gemini** (Generative Language API) | AI feature provider — `gemini-3-flash-preview`. Phase 4 full place_profile, Phase 6 NL search (both shipped); since v1.28.0 also the one read per Instagram post | [[gemini]] |
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

When parsing a Google Maps URL or importing places, the app picks an enrichment provider in this order:

1. **Google Places** — if the user has a personal `google_api_key` AND `profiles.google_places_enabled = true`.
2. **DataForSEO** — fallback. Server-side credentials, available to every user.

The user can disable Google explicitly in Settings → API (`googlePlacesEnabled = false`) even with a key, forcing DataForSEO.

The Instagram import (v1.28.0) is different on the matching side: it always finds candidates with Google Text Search on the user's key — the toggle is not consulted, and without a key it does not start — and then enriches the places it adds through DataForSEO in the import queue, like any import. See [[../05-flows/instagram-import-flow]].

## Cost-tracked SKUs

Every external API call that costs money goes through one of two trackers, both writing to the same `api_usage` table via `increment_api_usage` RPC:

- **`trackUsage`** in `src/lib/google/track-usage.ts` — for Google, DataForSEO, Mapbox (search sessions, Directions) and HikerAPI.
- **`trackAiUsage`** in `src/lib/ai/track-usage.ts` — for AI/LLM calls.

SKUs — the keys of `SKU_CONFIG` and `AI_SKU_CONFIG`; the canonical list with prices is [[../02-backend/schema/api_usage]]:

- Google Places: `text_search_pro`, `place_details_pro`, `reviews_enterprise`, `photos`, and `text_search_enterprise` (v1.28.0 — the Instagram import's candidate search, on the user's own key).
- DataForSEO: `dataforseo_business_info_live`, `dataforseo_reviews`.
- Mapbox: `mapbox_search_session`, `mapbox_directions` (v1.22.0); `mapbox_load` is registered but nothing tracks map loads.
- HikerAPI: `hikerapi_request` (v1.28.0).
- AI: `ai_place_profile`, `ai_parse_query`, `ai_rank_results`, `ai_compare`, `ai_chat`, `ai_trip_plan`, `ai_instagram_read` (v1.28.0), plus the unused `ai_embedding` placeholder.

Map tile loads are not counted — Mapbox shows them on its own dashboard.

## Adding a new integration

See [[../_agent/common-tasks#add-a-new-integration-third-party-service]].
