---
title: AI Search Flow (NL filtering, Phase 6)
type: flow
domain: places
version: 1.0.0
last_updated: 18.05.2026
status: stable
sources:
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/app/api/places/route.ts
  - src/components/search/ai-search-input.tsx
  - src/lib/hooks/use-ai-search.ts
  - src/lib/stores/ai-search-store.ts
  - src/components/map/map-content.tsx
  - src/components/places/place-card.tsx
related:
  - "[[../02-backend/api-routes/ai]]"
  - "[[../03-frontend/components/search]]"
  - "[[../04-integrations/gemini]]"
  - "[[full-profile-flow]]"
  - "[[../01-domain/places]]"
---

# AI Search Flow (NL filtering, Phase 6)

User types something like `"cozy cafes in Shoreditch for remote work"`
and the app:

1. Parses the query into structured filters + a semantic intent string.
2. Applies the structured filters through the existing places pipeline.
3. If the query has fuzzy intent beyond filters, ranks the result list
   with a second LLM call against each place's `searchable_summary`.

This is the first AI feature where the model is on the **interactive path**
(versus background enrichment). The full round-trip target is ~2-3s.

## Trigger

User types into [[../03-frontend/components/search#aisearchinput|AiSearchInput]]
in the FilterPanel and submits.

The input is gated — it doesn't render at all when `profiles.ai_features_enabled`
is false or `GOOGLE_GENERATIVE_AI_API_KEY` is missing.

## Steps

```
1. User types: "cozy cafes in Shoreditch for remote work"
       │
       ▼
2. AiSearchInput → useAiSearch.mutate(query)
       │  POST /api/ai/parse-query  { query }
       │
       │  Server gates: auth → ai_features_enabled → env key
       │
       │  buildUserContext(user) →
       │    { categories, subcategories, tags, lists, cities, countries }
       │
       │  buildParseQueryPrompt(query, ctx) →
       │    { systemPrompt: "You parse natural-language search…",
       │      userPrompt: "Query: …" }
       │
       │  generateText({
       │    model: gemini-flash-latest,
       │    output: Output.object({ schema: ParseQuerySchema }),
       │    system, prompt
       │  })
       │
       │  Sanitize: strip any LLM-emitted UUIDs not in ctx.
       │  Track usage: ai_parse_query SKU
       │
       │  ◄── ParseQueryOutput
       │      { hard: { category_ids: [cafeId] },
       │        soft_features: { atmosphere: ["cozy"], occasions: ["working"] },
       │        semantic_intent: "cafes in Shoreditch good for remote work",
       │        requires_semantic_ranking: true,
       │        needs_clarification: null }
       │
       ▼
3. Client onSuccess:
       │  • useFilters.setFilters({ ...hard, soft_features })
       │     → URL params update → /api/places refetches
       │  • useAiSearchStore.applyParse({ semantic_intent,
       │       requires_semantic_ranking, needs_clarification, query })
       │     → rerankStatus = "pending"
       │
       ▼
4. /api/places GET (with new params)
       │  • SQL filter (Layer 1): category, sub-cat, status, etc.
       │  • Post-filter (Layer 2): for each soft_features axis, intersect
       │    requested terms against google_data.place_profile.features.<axis>.
       │    Places without place_profile are excluded when soft filters
       │    are set.
       │  ◄── filtered places[]
       │
       ▼
5. useAiRerankOrchestrator(filters) (mounted in MapContent)
       │  Watches: needsRerank && places.length > 0 && !isFetching
       │  → POST /api/ai/rank-results  {
       │       semantic_intent,
       │       candidates: top-50 by recency, each with
       │                  { id, name, searchable_summary }
       │     }
       │
       │  Server:
       │    • cost guard: candidates.length ≤ 200
       │    • buildRankResultsPrompt(intent, candidates)
       │    • generateText({ model, output: RankResultsSchema, … })
       │    • Strip IDs not in input
       │    • Track usage: ai_rank_results SKU
       │
       │  ◄── { ranked: [{ id, score: 0-1, why: "…" }, ...] }
       │
       ▼
6. useAiSearchStore.applyRankings(ranked)
       │  rerankStatus = "ready"
       │
       ▼
7. UI re-renders:
       │  • MapContent place dropdown sorts visiblePlaceIds by score desc
       │  • Each card swaps address line for italic emerald `why`
       │  • Cards < LESS_RELEVANT_SCORE (0.3) fade to 60% opacity
       │  • Subtitle under input: "AI search: <query> · ranked"
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | `{ query: string ≤ 200 }` | `ParseQueryOutput` (no DB writes) |
| 4 | URL params (hard + soft) | `Place[]` filtered |
| 5 | `{ semantic_intent, candidates ≤ 200 }` | `RankResultsOutput` (no DB writes) |

## When does rerank run?

The LLM in step 2 sets `requires_semantic_ranking` based on the query's
content — **not** on result count.

| Query | requires_semantic_ranking |
|---|---|
| `"all my cafes"` | `false` — purely structural |
| `"cafes I haven't been to"` | `false` — visit_status covers it |
| `"cozy cafes for remote work"` | `true` — subjective fit |
| `"date night spots with great views"` | `true` |
| `"romantic dinner places"` | `true` |

Driving the decision from query content means small result sets (e.g. 5
cafes total) still get reranked when the query has semantic intent,
instead of being silently returned in default order.

## Failure modes

- **`parse-query` 5xx / timeout:** toast `"Couldn't understand that query."` UI doesn't change. User can retry.
- **`parse-query` returns clarification:** amber chip with the LLM's follow-up question under the input. Filters are NOT applied. User refines.
- **`/api/places` returns zero rows:** UI shows the existing empty state ("No places match your filters"). `rerankStatus` set to `"ready"` with empty rankings — orchestrator bails so the spinner doesn't hang.
- **`rank-results` 5xx / timeout:** `rerankStatus = "failed"`. Cards render in default order with no `why` line. Subtitle shows `· AI ranking unavailable`.
- **Cost guard (> 200 candidates):** rank-results returns 400. Client orchestrator catches as "failed". Indicates a pre-filter bug — should never happen with `TOP_N = 50` client-side cap.
- **`ai_features_enabled = false` set mid-session:** the AiSearchInput won't update until full page reload, but server routes will start returning 403 immediately, so attempts surface as toasts. Acceptable for now.

## Related code

- `src/app/api/ai/parse-query/route.ts`
- `src/app/api/ai/rank-results/route.ts`
- `src/lib/ai/schemas/parse-query.ts`
- `src/lib/ai/schemas/rank-results.ts`
- `src/lib/ai/prompts/parse-query.ts`
- `src/lib/ai/prompts/rank-results.ts`
- `src/lib/ai/context-builder.ts`
- `src/app/api/places/route.ts` (soft_features filter)
- `src/components/search/ai-search-input.tsx`
- `src/lib/hooks/use-ai-search.ts` (mutation + orchestrator)
- `src/lib/stores/ai-search-store.ts` (session state)
- `src/components/map/map-content.tsx` (orchestrator mount + sorted dropdown)
- `src/components/places/place-card.tsx` (why line + fade)

## Open questions

- **Location resolution for neighborhoods.** `"Shoreditch"` doesn't match `places.city = "London"` via hard. Currently the LLM is instructed to leave `hard.city` empty for neighborhood terms and let `semantic_intent` carry the hint into rerank. A future PR could add Mapbox geocode → bbox / lat-lng filter for stricter matching.
- **Score threshold (0.3) for "less relevant" fade.** Empirical. May need tuning with real query traffic.
- **TOP_N = 50.** Power users with thousands of saved places might miss good matches sitting deeper. Consider a per-user override in Settings → AI later, or a `"load more, rerank again"` button.
- **Cache parse-query.** Same query within a 5-min window shouldn't re-call. React Query handles this naturally via `queryKey: ["ai", "parse-query", query]` — TODO if costs prove a concern.
