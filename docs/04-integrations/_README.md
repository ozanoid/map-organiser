---
title: Integrations
type: overview
domain: integrations
version: 1.2.0
last_updated: 15.07.2026
status: stable
related:
  - "[[supabase]]"
  - "[[mapbox]]"
  - "[[google-places]]"
  - "[[dataforseo]]"
  - "[[gemini]]"
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
| **Google Gemini** (Generative Language API) | AI feature provider — `gemini-3-flash-preview`. Phase 4 full place_profile, Phase 6 NL search (both shipped) | [[gemini]] |

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

## Cost-tracked SKUs

Every external API call that costs money goes through one of two trackers, both writing to the same `api_usage` table via `increment_api_usage` RPC:

- **`trackUsage`** in `src/lib/google/track-usage.ts` — for Google + DataForSEO.
- **`trackAiUsage`** in `src/lib/ai/track-usage.ts` — for AI/LLM calls.

Observed SKUs (see [[../02-backend/schema/api_usage#sku-naming-convention]]):

- `google.text_search`
- `google.place_details`
- `google.place_photo`
- `dataforseo.business_info`
- `dataforseo.reviews`
- `ai_place_profile` (Phase 4) — one Gemini call per place_profile generation/refresh.
- `ai_parse_query` (Phase 6) — NL search parse; one per search (also the search-budget unit).
- `ai_rank_results` (Phase 6) — LLM-as-judge rerank when a query needs semantic ranking.

Mapbox calls (map tile loads, Directions) are **not** tracked through `api_usage` — Mapbox tracks them on their dashboard.

## Adding a new integration

See [[../_agent/common-tasks#add-a-new-integration-third-party-service]].
