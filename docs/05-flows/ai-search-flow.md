---
title: AI Search Flow (NL filtering, Phase 6)
type: flow
domain: places
version: 1.1.0
last_updated: 19.05.2026
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

1. Parses the query into a **three-layer match spec**: hard exclusion
   filters, soft feature axes, and semantic boosts.
2. Applies the hard + soft layers through the existing places pipeline.
3. If the query has fuzzy intent beyond filters, ranks the result list
   with a second LLM call against each place's `searchable_summary`,
   applying a score bump to boost-matched candidates.

This is the first AI feature where the model is on the **interactive path**
(versus background enrichment). The full round-trip target is ~2-3s.

## Three-layer match model

| Layer | What | Where applied | Excludes? |
|---|---|---|---|
| **Hard** | Categories, cities, visit_status, explicit sub-cat/tag/list refs | SQL filter in `/api/places` | **Yes** |
| **Soft features** | atmosphere, dietary, occasions, seating, cuisine_types | JSONB intersect server-side | Yes (when set) |
| **Boosts** | Semantic associations with curated tags/lists/sub-cats | Score bump in rank-results + opt-in UI hint chips | **No** |

**Why three layers and not two.** A previous design tried to put
everything into `hard` filters when the LLM saw a curated taxonomy match.
That broke discovery: query `"best date restaurants in london"` would
auto-filter by the user's "Date Spot" tag and "London Trip" list,
returning only places the user had ALREADY manually marked — which is
the opposite of what AI search should do. Boosts let the model say
"this curated item is thematically related" without excluding
non-matching candidates.

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
       │        boosts: { matching_tag_ids: [], matching_list_ids: [],
       │                  matching_subcategory_ids: [] },
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
       │                  { id, name, searchable_summary, subcategory_id },
       │       boost_tag_ids?, boost_list_ids?, boost_subcategory_ids?
       │     }
       │
       │  Server:
       │    • cost guard: candidates.length ≤ 200
       │    • buildRankResultsPrompt(intent, candidates)
       │    • generateText({ model, output: RankResultsSchema, … })
       │    • Strip IDs not in input
       │    • Boost post-process:
       │       - sub-cat boost: in-memory check vs candidates[i].subcategory_id
       │       - tag boost: SELECT place_id FROM place_tags WHERE tag_id IN
       │         (boost_tag_ids) AND place_id IN (candidates)
       │       - list boost: same against list_places
       │       - boosted scores: score = min(1, score + 0.15)
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
| `"best X" / "good X" / "recommend X" / "find me X"` | `true` (hard rule in prompt) |

Driving the decision from query content means small result sets (e.g. 5
cafes total) still get reranked when the query has semantic intent,
instead of being silently returned in default order.

## When does a tag/list/sub-cat go to `hard` vs `boosts`?

This is the most consequential prompt rule. The LLM must distinguish
between EXPLICIT reference (→ hard) and SEMANTIC association (→ boost):

| Query | Goes to `hard.*` | Goes to `boosts.*` |
|---|---|---|
| `"show me my date spot places"` | `tag_ids=[date_spot_id]` | — |
| `"places in my london trip list"` | `list_id=london_trip_id` | — |
| `"sushi restaurants"` | `subcategory_ids=[sushi_id]` | — |
| `"best date restaurants in london"` | `category_ids=[restaurant_id], city='London'` | `matching_tag_ids=[date_spot_id], matching_subcategory_ids=[fine_dining_id]` |
| `"good cafes for working"` | `category_ids=[cafe_id]` | possibly `matching_tag_ids=[work_friendly_id]` if such a tag exists |
| `"romantic dinner spots"` | `category_ids=[restaurant_id]` | `matching_tag_ids=[romantic_id]`, `matching_subcategory_ids=[fine_dining_id]` |

Rule of thumb: if the user could be looking for **additional** places
beyond the curated ones, it's a boost. If the user is asking to **list
the curated ones**, it's a hard filter.

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
