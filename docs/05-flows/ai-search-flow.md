---
title: AI Search Flow
type: flow
domain: ai
version: 2.0.1
last_updated: 25.11.2026
status: draft
sources:
  - src/components/filters/debounced-search-input.tsx
  - src/components/assistant/ask-assistant.tsx
  - src/lib/stores/map-area-store.ts
  - src/components/map/map-view.tsx
  - src/lib/agent/subject.ts
related:
  - "[[ai-chat-flow]]"
  - "[[../03-frontend/components/filters]]"
  - "[[../03-frontend/components/assistant]]"
  - "[[../04-integrations/claude-agent]]"
---

# AI Search Flow

Since v1.54.0 (Phase 2, decision 6.1) a question typed into the search field goes to the assistant: the search field is one of its doors. The keyword search the field does stays as it was; the Gemini AI search (below) is gone.

## Trigger

The filter **Search** field (`DebouncedSearchInput` — the map's filter sidebar, the mobile filter sheet, the `/places` header): while it holds text and the assistant can be used, a row under it offers **Ask the assistant**.

## Steps

1. A tap takes the words out of the field (the pending keyword filter is dropped — they are the assistant's question now, not a keyword) and calls `useAskFromSearch(page)`.
2. The request is the words as typed, **sent at once** (`openAssistant({ text, subject, send: true })`), with the screen as its subject: `{ kind: "view", page: "map" | "places", filters, area? }` — the filters on (by id: city, country, categories, sub-categories, tags, list, visit status, ratings, open now) and, on the map, the area in view (`useMapAreaStore`, which the map writes as it moves: its centre and the distance to a corner, `MapViewHandle.getArea`). Any view goes — a continent, a street, a map panned round the world (v1.56.1, after a view of Europe was refused in production); the app's prompt tells the model that `near` takes up to 30 km of it and that a wider area is a region (its city or country, or no place filter). The chip is named from the screen's caches until the server names it ("Map · Cafe, London").
3. The panel opens and sends it — unless a reply is being written or cards wait for an answer; then it waits in the composer. The mobile filter sheet closes first.
4. The server checks the subject and names it (`resolveSubject`: ids to names, the area rounded); the model reads it as "here" — it can search near the area or with the filters ([[ai-chat-flow]]).
5. The reply links the places it recommends; **Show these N on map** puts them on the map.

## Until v1.54.0: the Gemini AI search

A natural-language query went through `POST /api/ai/parse-query` (Gemini turned it into filters and a semantic intent), `/api/places`, and, for fuzzy intents, `POST /api/ai/rank-results` (Gemini scored the top 50 candidates; places under 0.2 were hidden, the others sorted by score with a "why" line, the sort locked as "AI Ranked", a broaden toggle when few matched). State lived in `useAiSearchStore`; one W3C `traceparent` stitched the three calls into one trace. The input itself left the UI in v1.23.0 (16.07.2026, the assistant became the AI entry point); only saved ✨ chips could still run it, and none were saved. Removed in v1.54.0 with its routes, schemas, prompts, store, hooks, banner, the `search` and `rank_backstop` budgets and the `api.places` diagnostic log; `ai_parse_query` and `ai_rank_results` stay for past rows (`retired`). The `saved_filters.ai_query` column is no longer written (dropping it needs its own approval).
