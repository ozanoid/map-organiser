# CHANGELOG

A running log of every meaningful change to the vault: new docs, structural changes, content rewrites, schema updates. Entries are newest-first.

Format: `## DD.MM.YYYY — vX.Y.Z — short title` followed by bullets.

---

## 19.05.2026 — v1.8.3 — Rerank schema resilience

Observed during live testing: an LLM response with one `why` string at
124 chars (target was 120) triggered Zod `max(120)` validation failure,
which AI SDK rethrows as `AI_NoObjectGeneratedError`. The route returned
500, orchestrator hit `failRerank()`, UI showed "AI ranking unavailable"
amber — for a 4-char overrun on a single entry out of 25.

LLM output length is non-deterministic; strict char caps are fragile.

### Fix — three layers of defense

1. **Prompt** (`prompts/rank-results.ts`): target raised from "≤ 120
   chars" to "≤ 200 chars, aim 120–180". Tells the LLM the actual cap.
2. **Schema preprocess** (`schemas/rank-results.ts`):
   - `why`: `z.preprocess(...)` truncates >200 chars → 197 chars + "…",
     then validates against `max(240)` as final safety net.
   - `score`: `z.preprocess(...)` clamps numbers outside [0, 1] back
     into range (defense against LLM emitting 1.05 etc).
3. **Salvage path** (`api/ai/rank-results/route.ts`): if AI SDK throws
   `AI_NoObjectGeneratedError` despite the preprocess (edge case if the
   SDK's validation layer bypasses preprocess), the catch block extracts
   the raw text from the error, parses it manually, runs it through the
   schema (preprocess fires), and uses the result. Logs a warning so we
   know salvage was hit.

### No behavior change for the happy path

When the LLM stays under target, all three layers are transparent —
same response, same rendering, same cost.

### No DB migration. No breaking changes.

---

## 19.05.2026 — v1.8.2 — Propagation race kill (the real fix)

The v1.8.1 lock-out reduced the rerank double-fire from 2 to 1, but
the *wrong* fire survived. Live test on `"restaurants for dating in
london"` (user has 25 London restaurants) showed:

- v1.8.0: two fires (50 stale, 25 fresh) — second won by luck
- v1.8.1: one fire (50 stale) — lock blocked the correct follow-up
- v1.8.2: one fire (25 fresh) ✓

### Root cause (proven with diagnostic logs)

`applyParse` is a zustand store update — propagates **synchronously**
through `useSyncExternalStore` notification.

`setFilters` (useFilters internal) is a React `useState` setter —
propagates on the **next** render commit.

Same event handler, both called sequentially, but they land in
*different* renders. The intermediate render has:
- new store state: `broadenStatus='checking'`, `rerankStatus='pending'`,
  `needsRerank=true`, `semanticIntent` set
- stale `filters`: still `{}` (pre-AI), `usePlaces({})` returns the
  cached 123-place all-places result

The broaden gate evaluates on this stale 123-place set, resolves to
"ready" (because no restricted hard filter), and triggers the rerank
gate which fires on stale data.

### Fix — `targetFilters` atomic gate

New store field captures the AI search's intended filter set ahead
of the React state update. Orchestrator gates wait until
`fpFilters(filters) === fpFilters(targetFilters)` — i.e., until
setFilters has propagated.

**Backend / store:**
- `ai-search-store`:
  - `targetFilters: PlaceFilters | null` — null when no AI search
    active. Set by `applyParse`, updated by `applyBroaden` and
    `setBroadenActiveMode`, cleared by `reset`.
  - `applyParse({..., targetFilters})` signature extended.

**Hook:**
- `useAiSearch.onSuccess` pre-computes the post-merge filter set
  via `mergeFiltersForTarget` (mirrors useFilters.setFilters logic
  for a deterministic snapshot) and passes it to `applyParse`.
- `useAiRerankOrchestrator` both effects (broaden + rerank) now
  check `!targetFilters` and fingerprint match before evaluating.
- Rerank `onSuccess` re-checks targetFilters at landing; if it
  changed mid-flight (broaden toggle, new query), discards the
  stale response.

**Diagnostic instrumentation (Slice 1):** verbose tick-by-tick
logging was added to confirm the race empirically, then removed in
Slice 3 after the fix was verified.

### Files touched

- `src/lib/stores/ai-search-store.ts` — targetFilters field + actions
- `src/lib/hooks/use-ai-search.ts` — fpFilters + mergeFiltersForTarget
  helpers, targetFilters gate in both orchestrator effects, stale-
  response discard
- `docs/05-flows/ai-search-flow.md` → v2.2.0 (race documented in
  rerank trigger section + v1.8.2 migration block)

### Cost

Same as v1.8.1 (~$0.005 per rerank), now reliably on the *correct*
candidate set. No more wasted spend on stale-data reranks.

### No DB migration. No breaking URL changes.

---

## 19.05.2026 — v1.8.1 — Rerank race fix + boost removal

Two follow-up corrections on top of the v1.8.0 pivot, observed on the
first live test of "restaurants for dating in london":

### Bug — rerank fired twice (~$0.01 instead of ~$0.005/query)

Logs from one parse-query showed two consecutive `[ai/rank-results]`
calls with different candidate counts (50, 25). The first call ran on
the previous filter's stale data; the second on the new filter set.
Whichever response landed last won the race and wrote rankings —
sometimes stale rankings for the user's current filter set.

Root causes:
- React Strict Mode dev double-mount of the rerank effect.
- Dep-driven re-runs across the places refetch transition (cache hit
  stale window → mid-fetch → fresh) — `places?.length` is in deps.
- `useFilters.setFilters` debounced URL sync (300ms) with immediate
  local state update: usePlaces sees new queryKey before URL settles,
  and React Query's `isFetching` window doesn't catch every transition.

Fix (`src/lib/hooks/use-ai-search.ts`):
- `rerankInFlightRef` (useRef) flipped SYNCHRONOUSLY before the await;
  blocks Strict-Mode re-mount + every dep-driven re-entry until the
  current call settles. Reset in the success/error callbacks.
- New guard: `status === 'success'` AND `!isFetching` — only fire rerank
  when usePlaces has settled on data for the CURRENT filter set.

### Boost / hint-chip removal

The v1.8.0 pivot removed boost SCORING but kept boosts as parse-query
output that drove an opt-in UI hint chip block in AISearchInput. The
hint chips repeatedly surfaced redundant suggestions (e.g. 'london'
tag boost when hard.city='London' was already set), and any signal
they carried is already accessible to the rank-results LLM through
the user-context block. Removed end-to-end:

- `ParseQuerySchema.boosts` field removed (`src/lib/ai/schemas/parse-query.ts`).
- Parse-query prompt: "Three output concerns" → "Two output concerns";
  "Layer 2 — boosts" section deleted; processing order step 5 (BOOSTS)
  removed; few-shots 1+2 stripped of boost lines; anti-pattern B
  rewritten to demonstrate semantic_intent over hard tag_ids
  (`src/lib/ai/prompts/parse-query.ts`).
- Parse-query route: boost validation block in `sanitizeAgainstContext`
  removed; fallback no longer emits `boosts: {}`; diagnostic log drops
  the boosts field (`src/app/api/ai/parse-query/route.ts`).
- Store: `BoostIds`, `boosts`, `EMPTY_BOOSTS` deleted; `applyParse`
  signature loses `boosts` (`src/lib/stores/ai-search-store.ts`).
- Hook: `useAiSearch.onSuccess` no longer maps boost IDs into the
  applyParse call (`src/lib/hooks/use-ai-search.ts`).
- UI: hint chip block + `applyHintAsFilter` removed; `useTags`,
  `useLists`, `useSubcategories`, `useMemo`, `Filter` icon imports
  dropped (`src/components/search/ai-search-input.tsx`).

### Vault
- `docs/05-flows/ai-search-flow.md` → v2.1.0. Architecture diagram
  trimmed to 2 concerns, rerank lockout/freshness guard documented,
  hint-chip references removed, v1.8.1 migration block added.

### Cost
~$0.00015 per parse-query (down from ~$0.0002 thanks to slimmer
prompt). Rerank cost unchanged (~$0.005), but reliably fires exactly
once per query instead of 2×.

### No DB migration. No breaking URL changes.

---

## 19.05.2026 — v1.8.0 — Phase 6.5: LLM-as-judge pivot

Architectural pivot of the NL search system. The v1.7.x rule-based soft
filter + boost mechanism is replaced by full LLM-as-judge. The rank-results
LLM receives each candidate's complete `place_profile` (features.* +
theme_insights + tldr + pros + cons + searchable_summary) and judges
holistically against a rich natural-language `semantic_intent`. The
vocabulary-mismatch and synonym-blindness bugs of v1.7.x (parse-query
emitted "date_night" snake_case while Phase 4 emitted "Date night" Title
Case + space) dissolve because string matching is gone — both sides
operate in natural language now.

### Design doc
Full rationale, decision log, and acceptance criteria in
`docs/_plans/phase-6-llm-as-judge-pivot.md`. 7 decisions cover hard-filter
scope, `semantic_intent` shape, adaptive cap + sort override + bol
payload, threshold + 6-tier rubric + LLM hide power, adaptive broaden
with banner, boost removal (hint chips kept), big bang migration.

### Schema changes
- `ParseQuerySchema.soft_features` REMOVED.
- `PlaceFilters.soft_features` REMOVED.
- `RankCandidate` extended with `features`, `theme_insights`, `tldr`,
  `pros`, `cons`.
- Rerank request body no longer accepts `boost_*_ids`.

### Backend
- `src/lib/ai/prompts/parse-query.ts` — full rewrite for 3-concern
  output (hard / boosts / semantic_intent). Token consumption rule
  for `requires_semantic_ranking`. Answer engine framing. 7 few-shots,
  5 anti-patterns.
- `src/lib/ai/prompts/rank-results.ts` — full rewrite. 6-tier rubric
  with explicit DISPLAY THRESHOLD = 0.20. LLM has "hide power".
  Candidate input includes the full profile.
- `src/app/api/ai/rank-results/route.ts` — boost post-process REMOVED.
  Diagnostic log surfaces `hidden_below_0.20` count.
- `src/app/api/places/route.ts` — entire soft-feature filter block +
  SOFT_AXES enum + canonFeature helper REMOVED.

### Frontend
- `src/lib/types/index.ts` — `PlaceFilters.soft_features` dropped.
- `src/lib/hooks/use-filters.ts` + `use-places.ts` — soft_features
  paths removed. Old `?f_*` bookmark URLs silently ignored.
- `src/lib/hooks/use-ai-search.ts` — broaden orchestration added
  (two-stage useEffect: broaden gate then rerank). Rerank body extended
  with full payload.
- `src/lib/stores/ai-search-store.ts` — new `broaden` state +
  `broadenStatus` machine. `setBroadenActiveMode` action.
  `LESS_RELEVANT_SCORE` (0.15) → `HIDE_BELOW_SCORE` (0.20). New
  `BROADEN_THRESHOLD = 10`.
- `src/components/places/place-card.tsx` — fade replaced with HIDE
  (returns null < 0.20). New `className` prop for wrapper composition.
- `src/app/(app)/places/page.tsx` — SelectablePlaceCard refactored to
  ~35-line composition over PlaceCard (was ~165 LOC duplicate). Sort
  dropdown swapped for "AI Ranked" badge when active. Grid sorted by
  rerank score.
- `src/components/map/map-content.tsx` — markers filtered by score
  ≥ 0.20. Sidebar dropdown sorted + filtered. Badge count post-threshold.
- `src/components/filters/filter-panel.tsx` — sort dropdown swapped
  for "AI Ranked" badge when active.
- `src/components/search/ai-search-input.tsx` — broaden banner with
  narrow/broader toggle.

### Vault
- `docs/_plans/phase-6-llm-as-judge-pivot.md` (NEW) — design doc.
- `docs/05-flows/ai-search-flow.md` — major rewrite to v2.0.0.

### Cost
- `ai_parse_query` — ~\$0.0002/call.
- `ai_rank_results` — ~\$0.005/call at 50 candidates with full payload
  (was ~\$0.002 summary-only).

### Migration / breaking
- Big bang deploy. Old `?f_*` bookmark URLs silently ignored — only
  structural filters apply. No DB migration.

---

## 19.05.2026 — v1.7.4 — system fix: city + country are a pair

Live test of "restaurants for dating in london" returned different
behaviour from "fine dining restaurants in london" even though both
queries should hit the same Location filter. Diagnosis revealed a
multi-layer system bug, not just a prompt issue:

- The LLM was inconsistent — sometimes set `hard.country` alongside
  `hard.city`, sometimes only `hard.city`.
- The filter UI (`CountryCityFilter`) is country-first cascading: city
  dropdown is scoped to "cities under the selected country". With
  `country` empty, the dropdown can't show the city, even though the
  URL state has it. User sees "All countries" and reads it as "filter
  not applied".
- Soft-features + rerank combo against profile-less places clusters
  scores in 0.10–0.25 range; the previous `LESS_RELEVANT_SCORE = 0.3`
  faded the whole result list to 60% opacity, looking like "no
  matches".

This is the fix the user explicitly requested be **complete** rather
than incremental. Four guards, three layers, no static safety net.

### 1. Context format
- `src/lib/ai/context-builder.ts`: `UserContext` gains `cityToCountries:
  Map<string, string[]>` derived from the user's own places. Ordered
  by occurrence frequency so the most-common country comes first.
- New helper `countriesForCity(ctx, city)` — case-insensitive lookup
  for server-side use.
- `serializeUserContext` now emits a `Cities by country:` block
  alongside the existing flat lists. LLM sees `London → United
  Kingdom` inline, not as two separate cities/countries arrays.

### 2. Prompt rule
- `src/lib/ai/prompts/parse-query.ts`: Layer 1 LOCATION step rewritten
  as "city + country are a PAIR — never one without the other". Use
  the country from the mapping.
- Few-shots 1, 2, 6, 7 updated to show the pair set together.
- New ANTI-PATTERN C: "setting hard.city without hard.country" with
  the literal failure case from the live test.

### 3. Server-side data-driven backfill
- `src/app/api/ai/parse-query/route.ts`: new `pairCityWithCountry`
  post-sanitization step. If `hard.city` is set but `hard.country` is
  missing, look up the country from the user's `cityToCountries`
  map. NOT static — works for every city the user has saved.
- Logs `[ai/parse-query] paired city='X' with inferred country='Y'`
  when the safety net fires; surfaces prompt-rule misses for tuning.

### 4. UI cascade fallback
- `src/components/filters/country-city-filter.tsx`: city dropdown now
  renders when EITHER country is set OR city is already in URL state.
  When country isn't set, the dropdown lists every distinct city in
  the user's collection. Defense-in-depth for the rare case where the
  LLM picks a city the user doesn't have (server can't infer country).

### 5. Score threshold tune
- `src/lib/stores/ai-search-store.ts`: `LESS_RELEVANT_SCORE` 0.3 → 0.15.
  Justified by the observed score clustering when most candidates
  lack `place_profile.searchable_summary`. Truly mismatched (~0.0)
  still fades; borderline now displays at full opacity.

### 6. Soft-feature vocabulary canonicalization
After the user backfilled profiles, soft-filter for "date_night" still
returned 0 even though many places had `occasions: ["Date night", ...]`.
Root cause: the parse-query LLM and place-profile LLM were never
aligned on feature format.

- `place_profile.features.*` stores Title Case with spaces:
  `["Cozy","Intimate","Romantic"]`, `["Date night","Casual Dinner"]`.
- `parse-query.soft_features.*` emits snake_case lowercase:
  `["romantic","intimate"]`, `["date_night"]`.

`String.includes("date_night")` against `["Date night"]` is FALSE —
literal mismatch. Single-word axes (atmosphere "Cozy" → "cozy") worked
by accident; multi-word axes (occasions "Date night" vs "date_night")
silently failed.

Fix in `src/app/api/places/route.ts` soft filter: new `canonFeature`
helper lowercases AND collapses whitespace/dashes to single underscore
on BOTH sides before comparison. No data migration; no prompt
realignment needed; future-proof against either LLM drifting format.

```ts
const canonFeature = (v: string): string =>
  v.toLowerCase().replace(/[-\s]+/g, "_").replace(/_+/g, "_");
```

Effect: "Date night" → "date_night", "Casual Dinner" → "casual_dinner",
"Bar Seat" → "bar_seat" — all match the parse-query LLM's canonical
form. Atmosphere etc. still works (single words pass through).

### Vault
- `docs/05-flows/ai-search-flow.md` — new "City + country are a pair"
  section documenting the four guards.
- This CHANGELOG entry.

### Test plan
- [ ] After deploy, query "restaurants for dating in london" on admin.
      Expected: `hard.country='United Kingdom'` set (LLM or backfill),
      Location chip shows UK + London, ≥1 result.
- [ ] Query "fine dining in barcelona" on a user with Barcelona places.
      Expected: pair set, UI cascade renders, results returned.
- [ ] Query "cafes" on a user with multiple countries. Expected: no
      city/country set (no location word in query), all countries
      returned.
- [ ] Hand-set country=undefined, city="London" via URL. Expected: UI
      cascade now shows city dropdown with full city list.

---

## 19.05.2026 — v1.7.1 — Phase 6: hard/soft/boosts split (discovery fix)

Test of `"best date restaurants in london"` exposed a critical design
flaw in the v1.7.0 prompt: the LLM was eager to map ANY semantic match
in the user's curated taxonomy to a hard filter — picking `tag=Date Spot`
and `list=London Trip` automatically. Two problems:

1. **Discovery-killer.** Filtering by the user's "Date Spot" tag returns
   only places they've ALREADY manually marked. The user is looking for
   recommendations — they want both their curated favorites AND new
   candidates the AI thinks fit. The original behavior was the opposite.
2. **List trap.** "London Trip" matched on word-overlap with the query;
   filtering by it locked the result to a pre-curated set, again killing
   discovery.

### The fix: three-layer match model

The parse-query schema now returns a third layer, `boosts`, alongside
the existing `hard` and `soft_features`:

- **`hard`** — exclusion filters. Tag/list/sub-cat go here ONLY when the
  user EXPLICITLY references them ("my date-spot places", "in my London
  trip list", "sushi restaurants").
- **`soft_features`** — per-axis descriptor match against
  place_profile.features.*. Unchanged from v1.7.0.
- **`boosts`** (NEW) — semantic associations with curated taxonomy.
  These DON'T filter; rank-results upweights matched candidates by +0.15.
  Also surfaced as opt-in UI hint chips so the user can manually convert
  them into hard filters if they want to narrow.

### Prompt rewrite

`src/lib/ai/prompts/parse-query.ts` now opens with the core principle
("Hard filter ≠ Soft signal"), enumerates EXPLICIT vs SEMANTIC triggers,
and includes six few-shot examples covering all the failure modes:

- `"best date restaurants in london"` → category+city hard, boosts for
  date-related tags/sub-cats, soft features romantic/intimate
- `"show me my date spot places"` → hard tag filter (EXPLICIT "my")
- `"sushi restaurants i haven't been to"` → all hard (explicit names)
- `"cozy cafes for remote work"` → hard category + soft only
- `"places from my london trip with great reviews"` → hard list+rating
- `"good vegan brunch in berlin"` → hard city + soft + rerank

Also: `requires_semantic_ranking = true` is now MANDATORY for queries
containing "best", "good", "recommend", or "find" — these are
discovery signals that always need rerank.

### Boost post-processing in rank-results

`POST /api/ai/rank-results` now accepts optional `boost_tag_ids`,
`boost_list_ids`, `boost_subcategory_ids`. After base scores come back
from the LLM:

- **Sub-cat boost** — in-memory check against each candidate's
  `subcategory_id` (now carried in the candidate payload).
- **Tag boost** — single Supabase query: `place_tags WHERE tag_id IN
  (boosts) AND place_id IN (candidates)`. RLS handles user scoping.
- **List boost** — same against `list_places`.

Boosted candidates: `score = min(1, score + 0.15)`. Empirical delta —
moves a borderline 0.5 match past an un-boosted 0.6, but doesn't
override a strong 0.85+ match.

### UI: hint chips

`AiSearchInput` renders a row of small clickable chips below the
clarification line when boosts are non-empty:

```
💡 You have curated items that may match. Narrow further?
   [tag · Date Spot]  [sub-cat · Fine Dining]  [list · London Trip]
```

One click → `setFilters({ tag_ids: [id] })` (or list/sub-cat
equivalent) → opt-in narrowing. Chip labels resolved via existing
`useTags`/`useLists`/`useSubcategories` hooks.

### Files changed

**Backend**
- `src/lib/ai/schemas/parse-query.ts` — added `boosts` field
- `src/lib/ai/prompts/parse-query.ts` — three-layer rewrite + 6 few-shots
- `src/app/api/ai/parse-query/route.ts` — sanitize boost IDs
- `src/app/api/ai/rank-results/route.ts` — accept boosts, score bump

**Frontend**
- `src/lib/stores/ai-search-store.ts` — `boosts` in session state
- `src/lib/hooks/use-ai-search.ts` — passes boosts to applyParse + rerank
- `src/components/search/ai-search-input.tsx` — hint chips UI

**Vault**
- `02-backend/api-routes/ai.md` — boost field + post-processing docs
- `03-frontend/components/search.md` — hint chips + state shape update
- `05-flows/ai-search-flow.md` — three-layer model section + when-to-hard-vs-boost table

### Cost impact

- `ai_parse_query` — slightly larger prompt (+200 tokens for few-shots).
  Marginal cost increase ~$0.00005/call.
- `ai_rank_results` — boost lookup is 0-2 small Supabase queries; no LLM
  cost change.

---

## 18.05.2026 — v1.7.0 — Phase 6: AI-01 natural-language filtering

First **interactive** AI feature in the app — the model is on the user-
waiting path, not background enrichment. A search box at the top of the
FilterPanel takes free-form queries ("cozy cafes in Shoreditch for
remote work"), parses them into the existing filter shape, and reranks
the result list when the query has fuzzy intent that hard + soft
filters can't express.

### Three-layer matching pipeline
- **Layer 1 — hard:** LLM returns category/sub-cat/tag IDs, city,
  visit_status, etc. Plain SQL filters via the existing `/api/places`
  pipeline. Defense-in-depth: server strips any UUID the LLM emits
  that isn't in the user's actual context.
- **Layer 2 — soft features:** LLM returns per-axis descriptors
  (atmosphere, dietary, occasions, seating, cuisine_types). `/api/places`
  intersects these against `place_profile.features.*` server-side —
  no LLM call. Places without a `place_profile` are excluded when soft
  filters are set.
- **Layer 3 — semantic rerank:** when the LLM sets
  `requires_semantic_ranking: true`, `/api/ai/rank-results` scores the
  filtered candidates against the query's semantic intent using each
  place's `place_profile.searchable_summary`. The rerank trigger comes
  from query content, NOT result count — a 5-candidate "cozy cafes for
  remote work" query still gets reranked.

### Added (code)
- `src/app/api/ai/parse-query/route.ts` — Layer 1+2 dispatcher
- `src/app/api/ai/rank-results/route.ts` — Layer 3 LLM-as-judge
- `src/lib/ai/prompts/parse-query.ts`, `prompts/rank-results.ts`
- `src/lib/ai/schemas/rank-results.ts` (parse-query schema was shipped
  in Phase 1; route + prompt now consume it)
- `src/lib/stores/ai-search-store.ts` — Zustand for transient
  per-session state (semanticIntent, rankings, rerankStatus, clarification)
- `src/lib/hooks/use-ai-search.ts` — `useAiSearch` mutation +
  `useAiRerankOrchestrator` side-effect hook
- `src/components/search/ai-search-input.tsx` — the input UI

### Changed (code)
- `src/lib/types/index.ts` — `PlaceFilters.soft_features` field
- `src/app/api/places/route.ts` — parse `f_<axis>` params, post-filter
  via JSONB intersect
- `src/lib/hooks/use-filters.ts` — round-trip soft_features through
  URL params (fan-out: `?f_atmosphere=cozy&f_occasions=working`)
- `src/lib/hooks/use-places.ts` — forward `soft_features` to the API
  fetcher; drive-by also adds `subcategory_ids` forwarding (missing
  since Phase 2)
- `src/components/filters/filter-panel.tsx` — mount `AiSearchInput`
  at top; "Clear" resets the AI search store atomically
- `src/components/map/map-content.tsx` — mount rerank orchestrator;
  sort visiblePlaceIds by score; show LLM `why` line
- `src/components/places/place-card.tsx` — same `why` line replaces
  address when active; fade cards below 0.3 score

### Added (vault)
- `02-backend/api-routes/ai.md` — new AI route group doc
- `03-frontend/components/search.md` — new search components doc
- `05-flows/ai-search-flow.md` — full E2E flow

### Updated (vault)
- `02-backend/api-routes/_README.md` — AI group added, count bumped
- `03-frontend/components/_README.md` — search folder added
- `03-frontend/hooks/_README.md` — `useAiSearch` + orchestrator
- `03-frontend/state-management.md` — `soft_features` filter slot +
  `useAiSearchStore` documented
- `05-flows/_README.md` — `ai-search-flow` linked in index
- `04-integrations/gemini.md` — added two new SKUs to the callers
  table; documented background vs interactive split
- `docs/_plans/phase-6-nl-filtering.md` — v0.2 design doc that
  governed this PR (kept for now; archive after merge)

### Cost
- `ai_parse_query` SKU — ~\$0.0001/call
- `ai_rank_results` SKU — ~\$0.002/call at 50 candidates
- Typical user (20 queries/day, half rerank) — ~\$0.66/mo

### Known stale
- ESLint v10.4.0 (from PR #36) crashes `eslint-plugin-react` —
  unrelated to Phase 6; tsc clean; spawned as a separate fix-it task.

---

## 18.05.2026 — v1.6.3 — vault sync for AI Phases 1-5.5

Documentation-only rollup. After Phases 1 through 5.5 shipped across PRs
#30-#35, an audit found 17 stale docs (referenced obsolete behavior or
missed new surfaces) plus 1 missing integration doc. This release brings
the vault back in sync with code as of the post-Phase-5.5 main branch.
No code changes.

### Updated (17 docs)
- `00-overview/system-overview.md` — added AI subsystem row + `src/lib/ai/`
  to sources.
- `00-overview/repo-structure.md` — added `src/lib/ai/` tree (client,
  schemas, prompts, extract); refreshed places/, settings/ component
  listings; updated API route group list and counts.
- `00-overview/tech-stack.md` — new **AI** section (ai SDK v6,
  @ai-sdk/google v3); added Gemini to external integrations.
- `00-overview/glossary.md` — added Sub-category entry + new **AI**
  section (place_profile, lite/full paths, 4-band auto-apply, AI master
  toggle, AI Suggestions queue, category change proposal, ai_place_profile
  SKU, Gemini Flash).
- `01-domain/categories-and-tags.md` — renamed to include sub-categories;
  documented 62-slug default dictionary across 11 parents; added AI
  interaction section.
- `01-domain/places.md` — added `subcategory_id` field;  new section
  documenting `google_data.place_profile` shape (lite vs. full).
- `01-domain/users-and-profiles.md` — `ai_features_enabled` row + its
  semantics across the system.
- `02-backend/schema/profiles.md` — `ai_features_enabled` column +
  migration entry.
- `02-backend/schema/places.md` — `subcategory_id` column + FK + index;
  `place_profile` note in the `google_data` description.
- `02-backend/api-routes/_README.md` — Subcategories route group; User
  group extended with `/ai-settings` + `/ai-suggestions`; AI helpers
  added to common helpers table.
- `03-frontend/state-management.md` — Subcategories + AI suggestions
  query keys; invalidation conventions.
- `03-frontend/hooks/_README.md` — `useSubcategories` + `useAiSuggestions`
  in the hooks index.
- `03-frontend/components/_README.md` — updated folder index for the
  new component files per folder.
- `03-frontend/components/places.md` — AddPlaceDialog gains the AI
  Suggestions panel + sub-cat strip; new `AiSummaryCard` section
  (skeleton / full states).
- `03-frontend/components/settings.md` — new `AiSettings` and
  `AiSuggestionsQueue` sections; header updated from "Two components"
  to "Four components".
- `03-frontend/components/filters.md` — `CategoryFilter` cascade
  behavior documented.
- `04-integrations/_README.md` — Gemini under external services; AI
  SDK v6 under runtime libraries; `ai_place_profile` SKU; both trackers
  (`trackUsage`, `trackAiUsage`).
- `05-flows/_README.md` — added lite-profile-flow + full-profile-flow
  to the flow index.
- `05-flows/manual-place-create-flow.md` — flow now references inline
  lite_profile build at parse-link, sub-cat strip + AI panel in the
  dialog, and the step=profile chain after step=reviews.

### Added (1 doc)
- `04-integrations/gemini.md` — full integration doc. Account & access,
  NPM packages (`ai` + `@ai-sdk/google` direct, **not** Gateway), env
  vars, wiring snippet from `src/lib/ai/client.ts`, canonical AI SDK v6
  structured-output pattern, cost & limits (~$0.001/profile,
  $1/1000 calls), "Why direct, not Gateway?" rationale, prompt strategy,
  failure modes, open questions.

### Notes
- Frontmatter `last_updated` bumped to 18.05.2026 and `version` minor-
  bumped on every touched doc.
- Cross-links added between AI-touching docs and the new flows.
- `_archive/` and Phase 6+ planning docs intentionally untouched.

---

## 18.05.2026 — v1.6.2 — Phase 5.5: category-mismatch detection

The Hackney Comedy Club incident exposed a tutarsızlık: lite mapping
routed it to Bar & Nightlife at save time, but the LLM (correctly) read
the reviews and proposed Entertainment + a new `comedy-club` sub-cat.
The old apply-suggestions code wrote a sub-cat proposal targeting
Entertainment.id while the place stayed in Bar & Nightlife — accepting
it gave the user a comedy-club sub-cat under Entertainment that the
cascade filter couldn't reach from the place's actual parent.

This release fixes the root cause two ways: audit the rule-based lite
mapping so similar venues route correctly from the start, AND give the
LLM a structured way to override a save-time mistake via the moderation
queue.

### A) Lite mapping audit
- `src/lib/google/category-mapping.ts`:
  - `comedy_club`: Bar & Nightlife → **Entertainment**
  - `live_music_venue`: Bar & Nightlife → **Entertainment**
  - `concert_hall`: Museum & Culture → **Entertainment**
- `src/lib/ai/extract/category-resolver.ts` STRICT_TYPE_TO_SUB
  - `comedy_club` → `comedy-club` (Entertainment)
  - `live_music_venue` → `concert-venue` (Entertainment)
  - `karaoke` → `karaoke-bar` (Bar & Nightlife, was `jazz-bar`)
- Default seed dictionary (migration
  `update_default_subcategories_dict_with_comedy_karaoke`): added
  `comedy-club` under Entertainment, `karaoke-bar` under Bar & Nightlife.
  Backfill NOT performed for existing users — moderation queue handles
  that case organically.

### D) Category mismatch as a first-class signal
- Migration `update_ai_suggestions_queue_for_category_change`:
  - `type` CHECK extended with `'category_change'`.
  - New column `target_category_name text` — LLM's proposed parent name
    for `category_change` proposals and for `subcategory` proposals
    that imply a move.
- `place-profile-full.ts` prompt now includes `Currently assigned to
  category: <name>` plus an inline instruction telling the LLM it's
  allowed to push back when reviews contradict the rule-based mapping.
- `apply-suggestions.ts` refactored to a unified A/B/C/D decision tree:
  - **A** (same parent, existing sub-cat) → silent apply
  - **B** (same parent, new sub-cat) → queue type=`subcategory`
  - **C** (NEW parent + sub-cat) → queue type=`subcategory` with
    `parent_category_id`=LLM target and `target_category_name`=LLM
    primary; accept moves the place AND creates/reuses the sub-cat
    atomically
  - **D** (NEW parent, no usable sub-cat) → queue type=`category_change`
    with `target_category_name`=LLM primary; accept moves the place
    and nulls `places.subcategory_id` (old sub-cat lived under the old
    parent and no longer applies)
- `apply-suggestions.ts` context shape changed: takes `currentCategoryId`
  + `currentCategoryName` + full `categories` list (was `parentCategoryId`).
- Accept route `/api/user/ai-suggestions/[id]/accept`:
  - `subcategory` branch: when `target_category_name` is set, accept also
    updates `places.category_id` to `parent_category_id` atomically with
    the sub-cat assignment.
  - New `category_change` handler: resolves `target_category_name` →
    `category_id` via exact + fuzzy match against the user's category
    list, updates `places.category_id`, nulls `subcategory_id`.
  - Sibling collapse key extended with `target_category_name`.
- List route `/api/user/ai-suggestions` (GET):
  - Returns `target_category_name` and `sample_place_category_name`
    (the place's current parent, used by UI to render moves).
  - Group key extended so a sub-cat proposal under current parent vs.
    one paired with a category move appear as separate rows.
- `useAiSuggestions` hook + `AiSuggestion` type: extended with
  `'category_change'` and the two new fields.
- `AiSuggestionsQueue` UI:
  - 3rd group "Category changes" (ArrowRight icon).
  - For subcategory rows where the proposal implies a parent move,
    inline amber annotation: `moves "place name" from X → Y`.
- Vault: [[02-backend/schema/ai_suggestions_queue]] updated with the
  new column + lifecycle paths; [[05-flows/full-profile-flow]]
  decision matrix bumped to "Phase 5.5 unified" with 8 rows.

---

## 18.05.2026 — v1.6.1 — Phase 5 patch: drop list silent apply + accept-time fuzzy dedup

Two fixes on top of the Phase 5 PR after live testing surfaced edge cases:

- **Background list silent-apply removed.** `apply-suggestions.ts` no
  longer touches `list_places`. `suggested_lists` stays on the persisted
  `place_profile` for downstream use (search, future ranking) but is not
  acted on after save. The Add Place dialog (Phase 3 lite chips) is the
  only path that assigns places to lists from AI — opt-in by design.
  Rationale: LLM is strict (taxonomy), user intent is loose (geography).
  Silent-applying in the background contradicts whichever signal the user
  gave at save time. Documented in [[05-flows/full-profile-flow#why-no-list-silent-apply]].
- **Accept-time fuzzy dedup.** `POST /api/user/ai-suggestions/[id]/accept`
  was using exact `ilike` against the tag name. If the user manually
  created a near-match tag (e.g. `"Speakeasy"`) **after** the queue row
  was written, the LLM's later proposal (e.g. `"Speakeasy Vibe"`) would
  bypass dedup and create a duplicate. The accept handler now runs
  `isFuzzyMatch` over the user's full tag list (and over the parent's
  sub-categories for the subcategory branch) before deciding whether to
  insert. Match → reuse existing entity; no match → create new.
- Helper return shape: `applyProfileSuggestions` no longer returns
  `listsApplied`. The `step=profile` enrich route log line was updated to
  drop that field.

---

## 14.05.2026 — v1.6.0 — AI Phase 5: Moderation Queue UI

The Phase 4 background pipeline has been silently writing proposals to
`ai_suggestions_queue` since merge. This phase closes the loop with the
**human-in-the-loop UI**: Settings → AI tab now lists pending tag and
sub-category proposals with accept/reject controls, and a live count
badge on the tab itself surfaces backlog at a glance.

- **API routes**:
  - `GET /api/user/ai-suggestions` — lists pending proposals, pre-aggregated
    server-side by `(type, lower(value), parent_category_id)` so the same
    concept proposed by multiple places renders as one row with
    `occurrences` count. Joined with `places(name)` and `categories(name)`
    for UI context (sample place name, parent category label).
  - `POST /api/user/ai-suggestions/[id]/accept` — creates the entity
    (reuses if user already has one with that name/slug to avoid dupes),
    attaches it to every queued place (tag → `place_tags` insert with
    dedupe; sub-cat → `places.subcategory_id` update), and marks all
    sibling queue rows `status='accepted'`. Idempotent: second accept
    returns 409 `Already accepted`.
  - `POST /api/user/ai-suggestions/[id]/reject` — flips siblings to
    `status='rejected'`. Vocabulary untouched.
- **`useAiSuggestions` hook** — `useAiSuggestions` + `useAcceptAiSuggestion`
  + `useRejectAiSuggestion`. Mutations invalidate `["ai-suggestions"]`
  plus `["tags"]` / `["subcategories"]` / `["places"]` on accept so all
  consuming UIs refresh.
- **`AiSuggestionsQueue` component** — lives under the AI tab below the
  master toggle. Hidden when AI is disabled or unavailable. Empty-state
  copy explains where suggestions come from. Two grouped sections (Tags,
  Sub-categories) with per-row Accept (emerald button) + Reject (× icon)
  controls, in-flight loading states, and toast feedback. Each row shows
  the proposed value, parent (for sub-cats), the sample place that
  triggered it, occurrence count, and confidence percentage.
- **`AiTabTrigger`** — live count badge on the AI tab in Settings.
  Wraps `useAiSuggestions`; renders an emerald pill with the number when
  > 0. Single source of truth for the moderation backlog indicator.
- **Vault**:
  - [[02-backend/api-routes/user]] bumped to v1.1.0 with the 5 new endpoints
    documented (settings + suggestions group).
  - [[03-frontend/hooks/use-ai-suggestions]] (new).

---

## 14.05.2026 — v1.5.0 — AI Phase 4: Full Profile (first real LLM call)

**The big one.** First end-to-end Gemini Flash call in production: place is
saved → reviews land → background pipeline triggers `step=profile` → a
structured `PlaceProfile` (TLDR + pros/cons + theme insights + refined
features) gets persisted to `places.google_data.place_profile`. The place
detail page polls for it and renders the AI Summary card. Tag / list /
sub-category suggestions auto-apply where they match user entities; new
proposals queue for moderation (Phase 5 UI).

- **DB migration** `create_ai_suggestions_queue_table` — per-user moderation
  queue with type='tag'|'subcategory', confidence, status, partial UNIQUE
  index for case-insensitive dedup per pending row.
- **New extractors / prompt** (`src/lib/ai/`):
  - `prompts/place-profile-full.ts` — system+user prompt builder. Bakes user
    context (tags, categories, subcategories, lists, cities) inline and lists
    sub-cat slugs per parent so the LLM picks from the right vocabulary.
    Translates non-English reviews. 50-review window, 400-char-per-review cap.
  - `apply-suggestions.ts` — 3-band auto-apply policy. matched_existing
    tags/lists silent-apply (place_tags / list_places INSERT). new_proposals
    run through Phase 1's fuzzy dedup; rerouted ones silent-apply, true new
    ones queue. Sub-category: silent apply on existing match at conf ≥ 0.85;
    queue new proposal at conf ≥ 0.9.
- **`/api/places/[id]/enrich?step=profile`** — new branch in the existing
  enrich route. AI-features-gated, AI-key-gated, no-reviews-gated. Calls
  `generateText({ model: google('gemini-flash-latest'), output: Output.object({ schema: PlaceProfileSchema }) })`
  and persists the typed result. Tracks usage as SKU `ai_place_profile`
  (~$1/1k calls baseline). Force-stamps `completeness='full'`, `model_version`,
  `source_review_count` after the call to override anything the LLM gets wrong
  on meta fields.
- **Pipeline chain** — `step=reviews` now fires `step=profile`
  fire-and-forget at the end (gated by `ai_features_enabled`). Cookies are
  forwarded so the chained request runs as the user.
- **`AiSummaryCard`** — new client component in `src/components/places/`:
  - Skeleton state while waiting (`reviewsAvailable` AND
    `completeness !== 'full'`).
  - Full state: TLDR + 2-column highlights/cons + theme-insights pills
    (sentiment emoji + count + click-to-expand evidence quote) +
    distinctive feature pills.
  - Refresh button calls `step=profile` manually.
- **Place detail page** — new polling effect: 5s interval while
  `hasReviews && !isFullProfile`, capped at 2 minutes. Card slots in
  before the Amenities section.
- **Types** — `GooglePlaceData.place_profile?: Record<string, unknown>`
  (loosely typed in shared types; consumers cast to `PlaceProfile` from
  the Zod schema).
- **Vault**:
  - [[02-backend/schema/ai_suggestions_queue]] (new).
  - [[05-flows/full-profile-flow]] (new) — end-to-end including 3-band
    auto-apply matrix, failure modes, manual refresh, open questions.
- **Post-merge patches on the same PR**:
  - **Address-aware list matching**: `matchListsFromProfile` (Phase 3 lite
    path) now also tokenizes the place's `address` string on `, / \` and
    probes each segment against list names. Fixes the "Istanbul Cafes"
    list not matching when DataForSEO returns `city = "Kadıköy"` (the
    metropolitan city only appeared in the address). Short tokens (< 3
    chars) and house-number prefixes are stripped.
  - **AI Summary skeleton state Generate button**: pre-Phase-4 places
    have reviews but no auto-trigger ever fired for them. The skeleton
    state's refresh button (previously full-state only) is now visible
    in both states with copy "generate" (skeleton) / "refresh" (full).
    Gives users a manual escape hatch for older places + transient
    background failures.

---

## 14.05.2026 — v1.4.0 — AI Phase 3: Lite Profile in parse-link

First **user-visible AI surface**: paste a Google Maps URL into Add Place →
"✨ AI Suggestions" panel materializes instantly with tag/list chips and the
matching sub-category gets pre-selected when confidence is high. **Still
zero LLM calls** — all rule-based extraction off DataForSEO + Google types.

- **`src/lib/ai/extract/`** new directory:
  - `category-resolver.ts` — Google types → `(primary, sub_category, confidence)` via strict + loose mapping tables. Detects hybrid venues (restaurant + bar → `secondary_role`). Confidence: strict 0.95, loose 0.75, name-heuristic 0.7, no match 0.
  - `features-extractor.ts` — DataForSEO `attributes` + `price_level` + `total_photos` + `is_claimed` → `features` slice (cuisine/dietary/seating/distinctive/price_range). LLM-only fields (atmosphere/occasions/music/crowd) left empty.
  - `suggestions-from-profile.ts` — `matchTagsFromFeatures` (fuzzy match cuisines/dietary/distinctive against user tags) + `matchListsFromProfile` (city/country/category/cuisine match against user list names). Lite path emits matched_existing only; no new tag proposals (Phase 4 territory).
  - `lite-profile.ts` — top-level orchestrator returning a `lite` `PlaceProfile`.
- **`/api/places/parse-link` route** — appends `lite_profile` to both Google and DataForSEO response paths. New helper `buildLiteProfileForResponse` fetches `ai_features_enabled` + user's tags + lists, builds the profile, returns null on errors (fail-soft). Adds ~100ms to a ~3-4s parse.
- **`/api/places` POST + `useCreatePlace`** — accept `subcategory_id`. Phase 2's table now has a write path from the Add dialog.
- **`AddPlaceDialog`** — new "✨ AI Suggestions" panel: tag chips + list chips (opt-in, user clicks). Sub-category strip under the Category dropdown shows all parent sub-cats with a Sparkles icon on the AI-suggested one. Auto-pre-select sub-cat when confidence ≥ 0.85. Reset clears AI state too.
- **Auto-apply policy in dialog**: tag/list chips stay opt-in (user is right there); sub-category auto-selects on high confidence (one click deep behind a dropdown, removes friction). Per the 3-band design discussed before Phase 3.
- **Noise control — `SUPPRESSED_FROM_SUGGESTIONS`** (post-merge patch on top of the same PR): lite path now drops too-common attributes (`wifi`, `parking`, `reservations`, `photogenic`, `unclaimed`, `indoor`, `outdoor`, price-level strings) from tag-suggestion candidates. `features.*` keeps them in full; only the chip rail is filtered. Phase 4 LLM proposals will run through the same filter as a safety net. Rationale + Phase 4 fallback role documented in [[05-flows/lite-profile-flow#noise-control--suppressed_from_suggestions]].
- **Vault**: new [[05-flows/lite-profile-flow]] + parse-link section updated.

---

## 14.05.2026 — v1.3.0 — AI Phase 2: Subcategory infrastructure

Per-user subcategory table (under each parent category) + default
dictionary + filter cascade UI + Settings manage UI. **No AI behavior yet**
— Phase 4 will start populating subcategories via the AI place profile.

- **DB migrations**:
  - `create_subcategories_table` — per-user table with RLS (`auth.uid() = user_id`).
  - `add_subcategory_id_to_places` — nullable FK with `ON DELETE SET NULL`.
  - `create_seed_default_subcategories_function` — idempotent helper.
  - `create_subcategories_signup_trigger` — `z_on_profile_created_default_subcategories` (AFTER trigger order verified via `information_schema.triggers.action_order`).
  - `backfill_subcategories_for_existing_users` — 3 existing users seeded (62 sub-cats each).
- **Default dictionary** (62 entries across 11 of 12 parents) is encoded inside `seed_default_subcategories_for_user()`.
- **TypeScript**: `Subcategory` interface + `Place.subcategory_id` + `PlaceFilters.subcategory_ids`.
- **React Query hook** `useSubcategories` (+ `useCreateSubcategory`, `useDeleteSubcategory`).
- **API routes**:
  - `GET /api/subcategories` (with `?include_pending=true`).
  - `POST /api/subcategories` (Zod-validated, 409 on dup).
  - `PATCH /api/subcategories/[id]` (rename + approve pending).
  - `DELETE /api/subcategories/[id]` (cascades to places via SET NULL).
- **`GET /api/places`** — new `?subcategory=<id,id>` query param + joined `subcategory:subcategories(*)` select.
- **`useFilters`** — `subcategory_ids` URL state (`?subcategory=…`).
- **`CategoryFilter`** — cascade UI: when a parent is selected, sub-cat pills appear under it with parent-name labels.
- **Settings → Categories**: each row is now collapsible with `ChevronRight`. Expanded view shows child sub-cats + add/delete form. Default sub-cats can be deleted (places fall back to parent only).
- **Vault**: [[02-backend/schema/subcategories]], [[02-backend/api-routes/subcategories]], [[03-frontend/hooks/use-subcategories]] new docs.

---

## 14.05.2026 — v1.2.0 — AI Phase 1: foundation

Foundation layer for AI features (AI-01 NL filter, AI-03 categorization, AI-04 tag/list suggestions, AI-05 place profile pivot). No user-facing AI behavior yet — this PR only lays the rails.

- **DB migration** `add_ai_features_enabled_to_profiles` — new `profiles.ai_features_enabled boolean NOT NULL DEFAULT true` column. Master toggle for every AI feature.
- **`src/lib/ai/`** new directory:
  - `client.ts` — Gemini factory (`getAiClient()`, `FLASH_MODEL`, `MODEL_VERSION`, `isAiAvailable()`). Uses `@ai-sdk/google` v3 (already in `package.json`).
  - `normalize.ts` — string normalize + Levenshtein + fuzzy-match predicate (`isFuzzyMatch`).
  - `dedup.ts` — `dedupProposals()`: post-LLM fuzzy dedup against existing user entities. Tag/category/list duplication shield.
  - `track-usage.ts` — `trackAiUsage()` + AI_SKU_CONFIG (ai_parse_query, ai_rank_results, ai_place_profile, ai_embedding). Reuses existing `increment_api_usage` RPC.
  - `context-builder.ts` — `buildUserContext()` + `serializeUserContext()`. Built once per AI request; injected into every prompt.
  - `schemas/place-profile.ts` — `PlaceProfileSchema` (lite + full completeness, category_signals, features, theme_insights, searchable_summary).
  - `schemas/parse-query.ts` — `ParseQuerySchema` (hard filters + soft features + semantic_intent + needs_clarification).
  - `schemas/suggestions.ts` — `SuggestionsSchema` (chip UI slice).
- **`/api/user/ai-settings` route** — GET returns `{ enabled, available }`. PUT accepts `{ enabled }`. Zod-validated.
- **Settings → AI tab** — new tab with master toggle. Optimistic update, rollback on error. Surfaces `available: false` state when `GOOGLE_GENERATIVE_AI_API_KEY` env is missing.
- **`.env.local.example`** — `GOOGLE_GENERATIVE_AI_API_KEY=` added.
- **Vault**: [[06-ops/env-vars]] bumped to v1.2.0 with the new variable + canonical-list entry.

Phases 2-7 (subcategory infra, lite profile in parse-link, full profile pipeline, suggestions queue, AI-01 NL filtering, backfill) will land as separate PRs.

---

## 13.05.2026 — v1.1.3 — patch: search-save reviews loading loop

Places saved via the `/map` search box stayed in "Loading reviews..." forever on `/places/[id]` — polling was triggered (`google_data.cid` was set) but reviews never landed.

- `SearchResultPanel` now mirrors `AddPlaceDialog`'s two-step enrichment: await `step=info`, then fire-and-forget `step=reviews` using the CID from the info response (falls back to `_extended.cid`). The await acts as a DB roundtrip guarantee, eliminating the race against POST `/api/places`'s async photo-download UPDATE.
- Falls back to invalidating the `["places"]` cache when `step=info` itself errors (e.g. mapbox-only path with no `google_place_id`).

Extra cost: 1 DataForSEO `business_info_live` call per save (~$0.0054), matching the URL-paste flow.

---

## 13.05.2026 — v1.1.2 — patch: extract CID from FTid + prefer POI coords

Short-link shares (`maps.app.goo.gl/...`) resolve to URLs whose `data=` blob carries an FTid (`!1s0xCELL:0xCID`) and the POI's actual coordinates (`!3d!4d`), but the parser was throwing both away and falling back to text search with the viewport center.

- `src/lib/google/parse-maps-url.ts`:
  - When an FTid is present, the second hex is converted to a Google CID — parser now returns `type: "cid"` with the decimal CID. DataForSEO accepts this as an exact-match key, bypassing the lossy text-search path entirely.
  - `extractCoordinates` now prefers `!3d!4d` (POI actual location) over `@lat,lng` (viewport center). The two can differ by 1+ km in real-world shares.
  - `ParsedUrl` now exposes the resolved URL via `resolvedUrl?: string` for any future re-inspection.
- `/api/places/parse-link`: handles the new `type: "cid"` branch — issues `keyword: "cid:<decimal>"` straight to DataForSEO.

Real-world impact: e.g. `https://maps.app.goo.gl/m6rXiaYaKLqEdqhh6` (Top Cuvée Highbury) used to 404 with "Could not find place details" because viewport center sat 1.3 km from the actual POI and "Top Cuvée Highbury" + 2 km bias still missed Google's text-search match. Now it resolves via CID on the first call.

---

## 13.05.2026 — v1.1.1 — patch: short-query parse-link match

Fixes "Could not find place details" for `/maps/place/Name/@lat,lng/` URLs where the parser only extracts a bare short name (e.g. `Beam`). Short generic keywords lose Google's text-search against same-named businesses worldwide even with a coordinate bias.

- `src/lib/mapbox/search-box.ts`: new exported `reverseGeocode({lng, lat})` helper wrapping Mapbox Search Box `/reverse`. Per-request endpoint, $1.70/1k, 50k/month free.
- `/api/places/parse-link`: when the parser yields `type: "search"` + coordinates, the route now reverse-geocodes once to fetch a `full_address` and appends it to the DataForSEO keyword (`"Beam, Stoke Newington Rd, London, UK"`). Search radius for this branch widened from 1000m → 2000m.
- Same trick already in `/api/search/retrieve/[id]`'s DataForSEO enrichment (v1.0 of F-01) — applied symmetrically here.

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
