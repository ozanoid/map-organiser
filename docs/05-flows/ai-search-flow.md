---
title: AI Search Flow (LLM-as-judge, Phase 6.5)
type: flow
domain: places
version: 2.5.1
last_updated: 20.05.2026
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
  - src/lib/telemetry/trace-context.ts
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
| All POSTs 429 | Monthly search budget spent (`AI_MONTHLY_SEARCH_CAP`, 500 searches/month — one unit per search, charged at parse) | Resets on the 1st (UTC). Surfaces as a toast on the search input. |
| Empty card grid in AI mode | LLM scored every candidate < 0.20 | Query may be too restrictive; toggle banner to broader |
| Broaden banner doesn't appear | narrow ≥ 10 OR no restricted hard | By design — no broaden needed |
| `[ai/parse-query] paired city` log fires | LLM emitted city without country | Server safety net (PR #44) kicks in |

## Cost

Gemini 3 Flash Preview rates ($0.50/$3.00 per 1M in/out, 15.07.2026):

- `ai_parse_query` — ~$0.0007/call.
- `ai_rank_results` — ~$0.015-0.025/call at 50 candidates with full
  payload (grows with the 250-400 word summaries). Worth it for
  cross-axis reasoning, but the dominant AI cost.

User with 20 semantic queries/day → ~$10-15/month at current pricing.

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

## v1.8.3 — Rerank schema resilience

LLM ocasionally exceeded the `why.max(120)` cap by a few chars (observed
124 chars), failing strict Zod validation and dropping the entire
response → "AI ranking unavailable" amber. Strict char caps on
non-deterministic LLM output are fragile.

Three layers of defense:
1. **Prompt** asks for ≤200 chars (target 120-180), warns that strings
   over 200 will be auto-truncated server-side.
2. **Schema preprocess** (`schemas/rank-results.ts`): `why` runs through
   `z.preprocess((v) => v.length > 200 ? v.slice(0,197)+"…" : v, z.string().max(240))`.
   `score` clamped to `[0,1]` in case the LLM emits 1.05 etc.
3. **Salvage path** (route catch): if AI SDK throws
   `AI_NoObjectGeneratedError`, extract the raw text from the error,
   `JSON.parse` it, run through `RankResultsSchema.parse()` (preprocess
   fires this time), use the result. Logs a warn.

## v1.8.4 — Skipped / hallucinated candidate handling

LLM sometimes returns fewer candidates than were sent ("skipped") or
emits ids not in the input ("hallucinated"). Both cases break the
client UI: places with no ranking entry fall back to the address
display, creating a confused mixed list (some with green why, some
with gray address).

Defense:
- Server detects both cases by set-diff between input candidate ids
  and response ids.
- Skipped candidates filled with `{score: 0, why: "Not evaluated by AI in this run."}`
  — score=0 hides them via the same HIDE_BELOW_SCORE threshold that
  hides LLM-judged irrelevant matches, so UX is consistent.
- Hallucinated ids dropped (existing `safeRanked` filter). Logged for
  visibility.
- New diagnostic line: `candidates llm_returned safe skipped
  out_of_range duplicates with_profile hidden_below_0.20 top5`.

## v1.8.5 — Cross-page state + LLM idx references

**Cross-page state** (Map ↔ Places): sidebar/mobile-nav links to Map
and Places now preserve the current URL's query string. Without this,
clicking "Places" from `/map?city=London&...` landed on `/places`
(params dropped), useFilters returned an empty filter set, and the AI
store still had rankings → confused UI with all places + AI mode
overlay.

**AISearchInput draft ↔ lastQuery sync**: input field's local `draft`
state now mirrors the store's `lastQuery` via a `useEffect`. Solves
two reports:
- FilterPanel "Clear" left the input box populated.
- Navigating /map → /places left the input empty even with the AI
  search still live in the store.

**LLM uses local idx instead of UUID**: prompt embeds candidates as
`idx=0`, `idx=1`, …; output schema is `{idx, score, why}`; server maps
`idx → candidates[idx].id` before responding. Empirical motivation
(v1.8.4 server log):

```
LLM skipped 1/25 candidate(s): Bistro Freddie (c73423aa-c740-…)
LLM hallucinated 1 id(s): 16b91296-dff2-…   ← one hex char off
```

The 36-char UUID copy was the dominant source of "hallucinated" entries.
Switching to integer idx makes UUID-typo hallucination structurally
impossible (out-of-range idx → trivially detected and rejected). Also
saves ~37 tokens/candidate input + ~37 output ≈ ~10% cost reduction on
a 25-candidate rerank.

Two schemas now live in `schemas/rank-results.ts`:
- `LlmRankSchema` (internal, `{idx, score, why}`) — what we ask the LLM.
- `RankResultsSchema` (public, `{id, score, why}`) — unchanged from
  earlier; client contract preserved.

## v1.8.6 — Suspense boundary fix (Vercel build)

`AppSidebar` and `MobileNav` use `useSearchParams()`. Next.js 16 App
Router requires any such client component to be wrapped in a
`<Suspense>` boundary, otherwise prerender of any (app) page (notably
`/import`, which has no dynamic data of its own) fails.

Fix: wrap both in `<Suspense>` in `(app)/layout.tsx` with sized
fallbacks (no CLS during hydration). Mobile nav also gained the same
`preserveSearch` flag — primary use case the user named was mobile
place-detail drill-down → back-to-map round-trip.

## v1.8.7 — Orchestrator mounted on /places

The orchestrator (`useAiRerankOrchestrator`) drives the broaden +
rerank state machine. Until v1.8.7, it was mounted only in
`MapContent`. But `AISearchInput` lives in `FilterPanel` which renders
on BOTH `/map` AND `/places`. Submitting a search on /places set
`rerankStatus="pending"` and then got stuck because nothing fired the
rank-results call — UI loading spinner forever.

Fix: mount `useAiRerankOrchestrator(filters)` at the top of
`PlacesContent` too. Same filters source as the existing
`usePlaces(filters)` call so they share the React Query cache (deduped).

This was a v1.8.0 oversight that survived every subsequent fix because
all stabilization testing happened on /map.

## v1.8.8 — Cross-route filter-persist store

`/map?city=London` → click Lists → /lists (URL params dropped because
Lists has no filter context) → click Map back → URL becomes `/map`
(bare), AI store survives (zustand singleton). UI showed AI active
mode with all places + green why texts only on the ranked subset.

Fix: new `filter-persist-store` (zustand singleton, session-only)
mirrors the last URL query string seen on /map or /places. Sidebar +
MobileNav read this store when navigating TO Map or Places from a
non-filter-context page; current URL otherwise.

Mirror is wired in MapContent + PlacesContent via:
```ts
useEffect(() => { setLastMapPlacesQuery(searchParams.toString()); },
         [searchParams, setLastMapPlacesQuery]);
```

FilterPanel "Clear" → URL clears → store auto-clears via the mirror.
No separate teardown needed.

## v1.10.0 — Pipeline trace propagation (Honeycomb waterfall)

The three pipeline calls (`parse-query` → `/api/places` →
`rank-results`) are separate browser-initiated requests, so in
Honeycomb they landed as three disconnected traces.

`useAiSearch` now mints one W3C `traceparent` per search
(`src/lib/telemetry/trace-context.ts` `newTraceparent()`), stores it on
`ai-search-store.traceparent`, and attaches it as a request header to
all three fetches — parse-query + rank-results in `use-ai-search.ts`,
`/api/places` in `use-places.ts`. `@vercel/otel`'s default W3C Trace
Context propagator continues the trace server-side, so the whole
pipeline forms ONE Honeycomb trace / waterfall.

Scope: the traceparent is dropped on `applyRankings` / `failRerank` /
`reset`, and on a no-rerank parse (`requires_semantic_ranking=false`),
so it never leaks onto later unrelated `/api/places` fetches.

Telemetry-only — no behaviour change to search, filters, or ranking.
See `docs/05-flows/observability-flow.md` for the pipeline-wide picture.

## Mount contract (debug reference)

Three coupled pieces must always be co-mounted; missing one causes
hard-to-debug stuck states:

| Page | `<FilterPanel>` (contains AISearchInput) | `useAiRerankOrchestrator(filters)` | Notes |
|---|---|---|---|
| `/map` (MapContent) | ✓ | ✓ | Original Phase 6 mount site |
| `/places` (PlacesContent) | ✓ | ✓ (since v1.8.7) | Added after orphan-orchestrator bug |
| `/lists/[id]` | ✗ | ✗ | AI search deliberately excluded |
| `/stats`, `/import`, `/settings` | ✗ | ✗ | No filter context |

**Rule of thumb:** if you add `<FilterPanel>` (or `<AiSearchInput>`
directly) to a new route, also add `useAiRerankOrchestrator(filters)`
in the same page component. Without the orchestrator, any AI search
submitted from that page hangs in `rerankStatus="pending"`.

## Diagnostic logging

Client-side `[ai-search/parse]` / `[ai-search/broaden]` / `[ai-search/rerank]`
events are gated:
- ON in development (`NODE_ENV !== "production"`)
- ON in any environment if `localStorage["ai-debug"] === "1"`
- OFF otherwise

To debug on a Vercel preview/prod build:
```js
localStorage.setItem("ai-debug", "1"); location.reload();
```

Same gating applies to `window.__aiSearchStore` and
`window.__filterPersistStore` exposures.

Server-side `[ai/rank-results]` and `[ai/parse-query]` logs are
always on (visible in Vercel logs).
