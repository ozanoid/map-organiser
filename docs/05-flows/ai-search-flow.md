---
title: AI Search Flow (LLM-as-judge, Phase 6.5)
type: flow
domain: places
version: 2.2.0
last_updated: 19.05.2026
status: stable
sources:
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/app/api/places/route.ts
  - src/components/search/ai-search-input.tsx
  - src/lib/ai/context-builder.ts
  - src/lib/ai/prompts/parse-query.ts
  - src/lib/ai/prompts/rank-results.ts
  - src/lib/hooks/use-ai-search.ts
  - src/lib/stores/ai-search-store.ts
  - src/components/map/map-content.tsx
  - src/components/places/place-card.tsx
  - src/components/filters/filter-panel.tsx
  - src/app/(app)/places/page.tsx
related:
  - "[[../_plans/phase-6-llm-as-judge-pivot]]"
  - "[[../02-backend/api-routes/ai]]"
  - "[[../03-frontend/components/search]]"
  - "[[../04-integrations/gemini]]"
  - "[[full-profile-flow]]"
  - "[[../01-domain/places]]"
---

# AI Search Flow (LLM-as-judge, Phase 6.5)

User types a natural-language query — `"restaurants for dating in london"`,
`"cozy cafes for remote work"`, `"all my vegan restaurants"` — and the
app turns it into a ranked answer set. Phase 6.5 rewrote the architecture
around **LLM-as-judge**: rule-based soft filtering is gone, the LLM does
holistic semantic matching against each candidate's full place_profile.

## Architecture (2 concerns)

```
parse-query (Gemini #1)
  ├─ hard filter (10 structural axes — SQL exclusion)
  ├─ semantic_intent (single rich natural-language string)
  └─ requires_semantic_ranking (token consumption check)

/api/places
  ├─ HARD filter SQL only
  ├─ AI search aktif → sort = google_rating_desc (override)
  └─ Soft filter REMOVED (moved to rank-results)

Adaptive broaden gate (orchestrator)
  ├─ narrow_count < 10 + restricted hard → drop sub-cat/tag/list
  ├─ Refetch with broader hard
  └─ User toggles narrow ↔ broader via banner

Rerank (Gemini #2)
  ├─ Full per-candidate payload:
  │   { id, name, searchable_summary, features (9 axis),
  │     theme_insights, tldr, pros, cons }
  ├─ Concurrent-call lockout (rerankInFlightRef)
  ├─ targetFilters fingerprint gate — waits out the applyParse
  │   vs setFilters propagation race (zustand sync lands a render
  │   before React useState; intermediate render has stale `filters`)
  ├─ Freshness guard (status==='success' && !isFetching)
  ├─ Stale-response discard (re-check targetFilters at landing)
  ├─ 6-tier scoring rubric with HIDE POWER (< 0.20 → hidden)
  └─ "Answer engine" framing — LLM is active curator

UI (mode-conditional)
  ├─ rankings === null → normal browsing UX unchanged
  └─ rankings !== null → AI active mode:
      - Cards/markers below threshold HIDDEN
      - Sort dropdown disabled, "AI Ranked" badge
      - Why line replaces address on cards
      - Broaden banner (when applicable)
```

> Boost / hint-chip layer was present in v1.8.0 but removed in v1.8.1.
> The rank-results LLM has the curated taxonomy in scope and surfaces
> matches via its own scoring; the UI hint chips were producing redundant
> suggestions (e.g. 'london' tag boost when hard.city='London' was set).

The full design rationale lives in `docs/_plans/phase-6-llm-as-judge-pivot.md`.

## Trigger

User types into [[../03-frontend/components/search#aisearchinput|AiSearchInput]]
in the FilterPanel and submits. The input is gated — hidden when
`profiles.ai_features_enabled = false` or `GOOGLE_GENERATIVE_AI_API_KEY`
is missing.

## Steps

```
1. User types: "restaurants for dating in london"
       │
       ▼
2. POST /api/ai/parse-query (Gemini #1)
       │  System prompt: 2-concern model, hard/semantic_intent,
       │  token consumption rule, answer engine framing, 7 few-shots
       │  + 5 anti-patterns + user context (Cities by country mapping)
       │
       │  ◄── ParseQueryOutput
       │      { hard: { category_ids, city: 'London',
       │                country: 'United Kingdom' },
       │        semantic_intent: 'London restaurants suitable for a
       │          romantic date: intimate, candlelit atmosphere; date
       │          night occasion; avoid loud sports-bar.',
       │        requires_semantic_ranking: true,
       │        needs_clarification: null }
       │
       ▼
3. useAiSearch.onSuccess:
       │  • setFilters({ ...hard, sort: 'google_rating_desc' })
       │     → URL params update → /api/places refetches
       │  • applyParse(...) → store.broadenStatus = 'checking',
       │     store.rerankStatus = 'pending'
       │
       ▼
4. /api/places GET (narrow hard filter)
       │  SQL: WHERE category + city + country (no soft filter)
       │  Returns narrow candidate set
       │
       ▼
5. Broaden gate (orchestrator, useAiSearch.useAiRerankOrchestrator)
       │  if narrow_count < 10 AND has restricted (subcat/tag/list):
       │    • applyBroaden(narrowFilters, broaderFilters, …,
       │                   activeMode='broader')
       │    • setFilters(broader) → /api/places refetches with broader
       │    • Re-enters effect; broaden state non-null →
       │      capture broaderCount, transition broadenStatus='ready'
       │  else:
       │    • resolveBroadenCheck() → broadenStatus='ready'
       │
       ▼
6. Rerank trigger (orchestrator's rerank effect)
       │  Pre-conditions (ALL must hold simultaneously):
       │    - needsRerank
       │    - broadenStatus === 'ready'
       │    - rerankStatus === 'pending'
       │    - rerankInFlightRef.current === false
       │    - targetFilters !== null
       │    - fpFilters(filters) === fpFilters(targetFilters)   ← v1.8.2
       │    - usePlaces.status === 'success'
       │    - !isFetching
       │
       │  The targetFilters fingerprint gate is the critical one. It
       │  catches the applyParse-vs-setFilters propagation race: zustand
       │  state lands one render before React useState, so an intermediate
       │  render has new store state but stale `filters`. Without the
       │  fingerprint check the orchestrator fires on the wrong (stale)
       │  data. See v1.8.2 section at end of doc for empirical trace.
       │
       │  POST /api/ai/rank-results
       │    body: {
       │      semantic_intent,
       │      candidates: top-TOP_N (50) by google_rating, each with:
       │        { id, name, searchable_summary, features (9 axis),
       │          theme_insights, tldr, pros, cons }
       │    }
       │
       │  Server (Gemini #2):
       │    • cost guard: candidates.length ≤ 200
       │    • LLM reads FULL profile + intent, scores 0..1 + why
       │    • 6-tier rubric: < 0.20 = HIDE
       │    • "Answer engine" framing: LLM actively filters trash
       │    • No post-process — LLM score is final
       │
       │  ◄── { ranked: [{ id, score, why }] }
       │
       ▼
7. UI re-renders (mode-conditional)
       │  /map:
       │    • placesForMap = places filtered to score >= 0.20
       │    • Markers hidden if < 0.20
       │    • Sidebar dropdown: sorted by score desc, why line
       │    • "N places" badge shows post-threshold count
       │
       │  /places:
       │    • sortedPlaces = places sorted by score desc
       │    • SelectablePlaceCard renders null if < 0.20 (via PlaceCard
       │      composition)
       │    • Sort dropdown replaced with "AI Ranked" disabled badge
       │
       │  AISearchInput:
       │    • Subtitle: "AI search: <query> · ranked"
       │    • Broaden banner (if applicable): narrow/broader toggle
       │    • Clarification chip (if LLM set needs_clarification)
```

## Mode-based UI behavior

```
Normal mode (rankings === null):
  /map      → all markers, sidebar with name+address, sort dropdown active
  /places   → cards with address, sort dropdown active
  /lists/[id] → unchanged (AI search not surfaced here)

AI active mode (rankings populated):
  /map      → markers filtered to score≥0.20, sidebar sorted+why,
              sort badge "AI Ranked"
  /places   → cards sorted by score, <0.20 hidden, sort badge "AI Ranked",
              why line replaces address
  Both     → broaden banner (if triggered), clarification (if needed)
```

Mode flag: `useAiSearchStore.rankings !== null`. All AI features
conditionally render on this flag.

## Hard filter scope (10 axes)

| Axis | Notes |
|---|---|
| category_ids | Always hard when explicit |
| city + country | Pair — never one without the other |
| visit_status | want_to_go / visited / booked / favorite |
| rating_min, google_rating_min | Numerical thresholds |
| created_after | ISO date from natural phrases |
| subcategory_ids | ONLY when EXPLICITLY named ("sushi", "fine dining") |
| tag_ids | ONLY when "my X-tagged" / "places I marked as X" |
| list_id | ONLY when "in my X list" / "from my X" |

Everything else (atmosphere, occasions, dietary, cuisine_types, seating,
music, crowd, price_range, distinctive, theme_insights, tldr, pros,
cons) → **LLM-judge in rank-results**, NOT hard, NOT soft filter.

## Token consumption rule

`requires_semantic_ranking` is computed by the parse-query LLM:
1. List distinguishing tokens in the query (filler words excluded).
2. For each, check if it's captured by `hard.*`.
3. ALL covered → `false`. ANY uncovered → `true`.

Examples:
- `"all my cafes"` → cafes consumed → **false**
- `"fine dining in london"` → all covered → **false**
- `"best date restaurants in london"` → best+date uncovered → **true**
- `"all my vegan restaurants"` → vegan uncovered → **true**

## Adaptive broaden

When narrow hard filter returns `< BROADEN_THRESHOLD = 10` candidates AND
has restricted axes (subcategory_ids, tag_ids, list_id):

1. Compute broader filter (drop restricted)
2. Refetch with broader
3. Store both filter sets + counts; default activeMode = "broader"
4. Banner shows: `"Found N matching <axis>. Showing M broader matches."`
5. Toggle buttons let user switch narrow ↔ broader; switching triggers
   re-rerank on the new candidate set.

## Hide power (rank-results LLM)

The rank-results prompt explicitly tells the LLM:

> DISPLAY THRESHOLD = 0.20. Anything you score below 0.20 will be HIDDEN
> from the user. Use this power deliberately to filter out clearly
> irrelevant matches.

6-tier rubric:
- 0.85-1.00 EXCELLENT — top result
- 0.65-0.85 GOOD — show with confidence
- 0.45-0.65 DECENT — show, mid-tier
- 0.25-0.45 MARGINAL — show at bottom
- 0.10-0.25 WEAK — borderline, may be hidden
- 0.00-0.10 IRRELEVANT — HIDE

Worked examples in the prompt cover date-restaurant scoring (McDonald's
→ 0.05, Bambi → 0.90, etc.).

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| All POSTs 403 | `ai_features_enabled = false` | Toggle in Settings → AI |
| All POSTs 503 | `GOOGLE_GENERATIVE_AI_API_KEY` missing | Set env, redeploy |
| Empty card grid in AI mode | LLM scored every candidate < 0.20 | Query may be too restrictive; toggle banner to broader |
| Broaden banner doesn't appear | narrow ≥ 10 OR no restricted hard | By design — no broaden needed |
| `[ai/parse-query] paired city` log fires | LLM emitted city without country | Server safety net (PR #44) kicks in |

## Cost

- `ai_parse_query` — ~$0.0002/call (slightly larger prompt for the new
  framing).
- `ai_rank_results` — ~$0.005/call at 50 candidates with full payload
  (was ~$0.002 in v1.7.x summary-only). Worth it for cross-axis reasoning.

User with 20 semantic queries/day → ~$3/month at current pricing.

## Related code

- `src/app/api/ai/parse-query/route.ts` + `src/lib/ai/prompts/parse-query.ts`
- `src/app/api/ai/rank-results/route.ts` + `src/lib/ai/prompts/rank-results.ts`
- `src/lib/ai/schemas/parse-query.ts`
- `src/lib/ai/context-builder.ts`
- `src/app/api/places/route.ts` (hard filter only, no soft)
- `src/components/search/ai-search-input.tsx` (banner + chips)
- `src/lib/hooks/use-ai-search.ts` (orchestrator + broaden + rerank)
- `src/lib/stores/ai-search-store.ts` (session state + thresholds)
- `src/components/map/map-content.tsx` (marker filter + sidebar sort)
- `src/components/places/place-card.tsx` (hide-below-threshold + why)
- `src/app/(app)/places/page.tsx` (SelectablePlaceCard composition,
  sort dropdown, grid sort)
- `src/components/filters/filter-panel.tsx` (sort dropdown disabled badge)

## Migration from v1.7.x (Phase 6.5 pivot)

- `ParseQuerySchema.soft_features` REMOVED
- `PlaceFilters.soft_features` REMOVED
- `/api/places` `?f_*` params SILENTLY IGNORED (graceful URL degradation)
- Rank-results body no longer accepts `boost_*_ids`
- Rerank payload includes `features`, `theme_insights`, `tldr`, `pros`,
  `cons` per candidate
- `LESS_RELEVANT_SCORE = 0.15` (fade) → `HIDE_BELOW_SCORE = 0.20` (hide)

No DB migration.

## v1.8.1 follow-up — boost / hint-chip removal + rerank race fix

- `ParseQuerySchema.boosts` REMOVED. Parse-query route, prompt, fallback,
  diagnostic log, and store no longer reference boost IDs.
- `AISearchInput` hint-chip block REMOVED. `applyHintAsFilter` deleted.
  `useTags`/`useLists`/`useSubcategories` imports dropped.
- `ai-search-store.boosts`, `BoostIds`, `EMPTY_BOOSTS` deleted.
- Rerank orchestrator gained a `rerankInFlightRef` lock + `status==='success'`
  freshness guard. Reduced double-fire but DID NOT eliminate the stale fire
  — see v1.8.2 for the actual root cause.

## v1.8.2 follow-up — propagation race fix (the real bug)

Slice 1 diagnostic logs revealed the v1.8.1 freshness guard was
inadequate. With 25 London restaurants, the trace showed:

```
tick 3  fp='{}'  placesLen=123  broadenStatus=checking → resolve
tick 4  fp='{}'  placesLen=123  broadenStatus=ready    → ★ FIRE (wrong!)
tick 5  fp=NEW  placesLen=undefined  isFetching=true   (fresh fetch starts)
tick 6  fp=NEW  placesLen=25  isFetching=false  → inFlight (blocked, correct fire suppressed)
```

**Root cause:** `applyParse` (zustand sync) and `setFilters` (React useState
async) don't propagate in the same render. Between the two, a render
exists where:
- store state is NEW (broadenStatus="checking" → "ready" resolves)
- useFilters' `filters` is STALE (still `{}` pre-AI)
- usePlaces returns the cached 123-place pre-AI result

The broaden gate evaluates on stale data and resolves; the rerank gate
fires on stale data. The v1.8.1 inFlightRef lock then blocks the
follow-up fire on fresh (correct) data.

**Fix — targetFilters atomic gate:**

- New store field: `targetFilters: PlaceFilters | null`.
- `applyParse({..., targetFilters})` snapshots the post-merge filter set
  ahead of the React state update (`mergeFiltersForTarget` mirrors
  useFilters' merge logic for a deterministic target).
- `applyBroaden` and `setBroadenActiveMode` keep targetFilters in sync
  with the active broaden mode's filter set.
- Orchestrator both gates check `fpFilters(filters) === fpFilters(targetFilters)`
  before doing anything. They wait out the propagation race.
- Rerank `onSuccess` re-checks targetFilters at landing; discards stale
  responses if the target changed mid-flight.

Expected post-fix trace (verified empirically):

```
tick 3  fp='{}'  targetFp=NEW   → skip: fp !== targetFp
tick 4  fp=NEW  isFetching=true → skip: isFetching
tick 5  fp=NEW  placesLen=25    → broaden resolve→ready
tick 6  fp=NEW                  → ★ FIRE on 25 places (correct)
```

Diagnostic instrumentation (v1.8.2 Slice 1) was removed after
verification; only the structural `fpFilters` helper and the
`mergeFiltersForTarget` merge mirror remain in the production path.
