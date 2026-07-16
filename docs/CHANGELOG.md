# CHANGELOG

A running log of every meaningful change to the vault: new docs, structural changes, content rewrites, schema updates. Entries are newest-first.

Format: `## DD.MM.YYYY — vX.Y.Z — short title` followed by bullets.

---

## 16.07.2026 — v1.22.0 — S4: Trip Intelligence (AI-09 v1 + NF-07/08)

Sprint S4 (v4 Tema 4) — single PR. Three live migrations
(`add_trip_days_routing_profile`, `add_trip_day_places_cost_columns`,
`add_trips_party_size`).

- **NF-07 multi-modal routing**: `trip_days.routing_profile`
  (walking/driving/cycling, CHECK + default) threaded through both
  `getRoute` call sites (trip detail + public shared view); day-header
  cycle toggle; new `PATCH /api/trips/[id]/days/[dayId]` (zod, two-level
  ownership). NEW `mapbox_directions` SKU — Directions calls were fully
  untracked before (public share burns the OWNER's quota, attributed via
  link.user_id). Day-level route cache remains v2.
- **NF-08 trip budget**: `trip_day_places.cost_estimate/currency` +
  `trips.party_size`; per-person defaults from `google_data.price_level`
  (hardcoded tier table 10/25/50/90 USD, `lib/trip/cost-defaults.ts`;
  66% coverage — empty-safe). Inline row edit, day totals, trip total ×
  party-size stepper. Costs now SURVIVE move-between-days and auto-plan
  rewrites (both were silently dropping row fields).
  `PATCH /api/trips/[id]` hardened with a zod whitelist (raw body spread
  made every column client-writable). Public shared-trip payload strips
  cost/currency/party_size.
- **AI-09 v1 AI trip plan**: `POST /api/ai/trip-plan` — candidates =
  in-trip places + opt-in want_to_go pool per city (max 40, compact
  ~350-token projections, day-granular open flags via new
  `isOpenOnDate`); idx-referenced `TripPlanSchema` (clamp/parseInt
  idioms); **delete-after-validate** write (LLM failure burns the unit
  but never empties the trip); per-stop `time_slot`+note, day
  `theme — rationale` → `trip_days.notes` (first consumers of those
  columns). SKU `ai_trip_plan` costPer1k 12.0, cap
  `AI_MONTHLY_TRIP_PLAN_CAP = 50`. Trip-header **AI Plan** dialog
  (ai-settings gated).
- **Review fixes (30/30 adversarial findings addressed), highlights:**
  - **HIGH:** a trip with >40 places would have every place beyond the
    LLM cap silently DELETED by AI Plan — now a 400 guard before any
    spend, plus the destructive delete is scoped to candidate places
    only (non-candidates always survive).
  - **HIGH (cross-user exfiltration):** a foreign place UUID (learned
    from any public share) could be attached to one's own trip —
    trip_day_places RLS only checks the day — and the public trip share
    (service client, full `places(*)` passthrough) then leaked the
    victim's ENTIRE row, bypassing the v1.20.0 whitelist. Fixed on both
    ends: place-ownership gates on every attach path (add-to-day, move,
    trip-create place_ids) AND all publicly embedded places (list +
    trip shares) now go through the same whitelist projection as the
    single-place share.
  - **HIGH:** trip-plan write phase checked no supabase errors
    (supabase-js returns, never throws) — a failed insert after the
    delete quietly emptied days behind success:true. Now: delete error →
    500 before harm; insert/notes errors collected → honest 500;
    TOCTOU carry re-read after the LLM call; stale day notes cleared.
  - Move-place is now a single atomic UPDATE (was delete+insert — a
    mid-move failure lost the row and its fields); day-scoped writes
    verify the day belongs to the URL's trip; date fields validated as
    ISO dates; LLM day_number duplicates deduped; 14-day and tldr-length
    caps; `include_pool` requires `city`; `output` accessor.
  - UI: cost/party edits no longer trigger full trip refetches (each one
    re-purchased a Mapbox Directions call per day) — targeted cache
    patches instead; route-mode cycle holds pending through the refetch;
    comma-decimal costs accepted; all new mutations toast on error.
  - Public-share Directions denial-of-wallet recorded as debt (PART 4
    #15 — day-level route cache, S5).
- Docs: new `05-flows/ai-trip-plan-flow.md`; schema docs (trips,
  trip_days, trip_day_places), api-routes trips/ai/_README/shared,
  mapbox.md (+directions SKU), gemini.md (caller table + budgets),
  ai-enrichment-flow (cost cap), use-trips.md, trip-planning-flow,
  domain trips/sharing, repo-structure, frontmatter-schema (+`ai`
  domain), v4 plan (4.8.0 + debt #15).

## 16.07.2026 — v1.21.0 — S3: AI chat assistant (AI-02 v1)

Sprint S3 (v4 Tema 3) — single PR. Chat-based discovery and action over
the saved-place library.

- **`POST /api/ai/chat`** — the repo's first STREAMING AI route:
  `streamText` + `stopWhen: stepCountIs(6)` agent loop,
  `toUIMessageStreamResponse()`. Standard 4-gate skeleton runs before
  the stream (auth → flag → client → budget → 429/403/503 survive as
  HTTP). `export const maxDuration = 120`. **Deliberate amendment** of
  gemini.md's "never streamText" rule — chat is the one surface where
  progressive output is the product; structured calls stay on
  generateText + Output.object.
- **7 tools** (`src/lib/ai/chat-tools.ts`), all under the request's
  cookie client (RLS = ownership boundary; hallucinated ids → honest
  not-found, no cross-user leak):
  - read-only: `search_places`, `get_place_details`, `compare_places`
    (data-only — the chat model verbalises; no nested ai_compare call),
    `get_stats`. Outputs are compact projections, never full
    google_data rows.
  - mutating with **v6 built-in approval** (`needsApproval: true` →
    confirm card → `addToolApprovalResponse`): `add_to_list`,
    `create_list`, `set_visit_status`.
- **Shared engines extracted** (verbatim, no behaviour change):
  GET /api/places query logic → `src/lib/places/query-places.ts`;
  GET /api/stats aggregation → `src/lib/places/user-stats.ts`. Routes
  are now thin shells over the same functions the tools call.
- **`ai_chat` SKU** — cap 200 turns/month (`AI_MONTHLY_CHAT_CAP`, code
  constant), costPer1k $15 (fixed average-turn estimate). ONE unit per
  user TURN charged in onFinish; an approval-continuation POST does not
  burn a second unit; stopWhen bounds in-turn fan-out. CostTracker picks
  the SKU up automatically.
- **UI**: `AssistantLauncher` (header ✨, ai-settings gate — hidden when
  AI off/unconfigured) + `AssistantPanel` (right Sheet, max-w-md
  override; full-width mobile). `useChat({chat})` with a module-scope
  Chat instance = session-only memory (survives panel close + client
  nav; "New chat" resets; nothing persisted — chat_memories is v2).
  Mutation outputs invalidate ["lists"]/["places"]/["stats"] since
  chat bypasses the TanStack mutation hooks.
- **Deps**: ai 6.0.184→6.0.228 + NEW @ai-sdk/react 3.0.230 —
  ⚠️ version-lockstep pair (plain `npm i @ai-sdk/react` would pull the
  4.x line and a nested ai@7 duplicate; always bump together).
- Langfuse: `propagateAttributes` now carries `sessionId` so a
  conversation's turns group into one session view; umbrella-span
  filter already covered streamText.
- **Review fixes (25/25 adversarial findings addressed):**
  - **HIGH:** the approval flow was DEAD — `sendAutomaticallyWhen`
    passed to `useChat()` is silently ignored when a prebuilt `chat`
    instance is supplied; moved into the `new Chat({...})` init. Also:
    composer now locks while an approval is pending (a typed message
    would poison history with a dangling approval-requested part and
    wedge the session), and the route passes
    `ignoreIncompleteToolCalls: true` for the Stop-mid-tool case.
  - `queryPlaces` with an ids-filter where no id survives UUID
    validation now returns EMPTY instead of the entire library
    (compare_places tool could dump all places into the loop).
  - Module-scope chat now binds to the auth user + resets on sign-out
    (shared-device cross-account history leak).
  - Budget: gate + charge only genuine new turns (crafted
    assistant-last histories can't ride the free continuation path;
    approval continuations no longer 429 at the cap boundary); onFinish
    logs `totalUsage` (all steps), not the final step's usage.
  - add_to_list/create_list pre-filter place ids by ownership
    (list_places RLS checks only list ownership — foreign ids inserted
    junk rows with dishonest counts); friendlyError matches response
    BODY (the 403 branch was dead code).
- Docs: new `05-flows/ai-chat-flow.md` + `components/assistant.md`;
  gemini.md (packages lockstep warning, caller table, streamText
  amendment, budgets paragraph), api-routes/ai.md (+chat section) +
  _README, places.md / stats.md extraction notes + sources,
  tech-stack.md, ai-search-flow.md + ai-enrichment-flow.md (cost cap),
  components/layout.md + _README, repo-structure, v4 plan (S3 row).

## 15.07.2026 — v1.20.0 — S2-PR2: saved filters + quick chips (F-03/NF-20/21) + single-place share (NF-18)

Closes sprint S2 (v4 Tema 2 + Tema 5'in kalanı).

- **THREE live DB migrations (Supabase MCP):**
  1. `create_saved_filters_table` — new per-user table (id, user_id FK
     auth.users CASCADE, name unique-per-user, query_string, ai_query,
     sort_order, created_at) + RLS (single ALL policy,
     `auth.uid() = user_id`, USING + WITH CHECK).
  2. `widen_shared_links_resource_type_add_place` — CHECK += 'place'
     (caught in DISCOVERY this time, before any code was written).
  3. `widen_places_source_check_add_shared` — **pre-existing latent bug
     found in passing**: the save-to-account copiers (saveList/saveTrip)
     have inserted `source: "shared"` since April but the CHECK never
     included it (0 such rows exist — the copy path could never have
     succeeded). Widened; savePlace now shares the same code path.
- **Saved filters**: `filtersToQueryString`/`parseUrlToFilters` exported;
  `use-saved-filters.ts` (browser-client CRUD, RLS boundary — tags/lists
  pattern); `SaveFilterButton` in the panel + sheet headers (captures
  LOCAL filter state, not the debounce-lagged URL; stores the NL query
  too when an AI search is active); `SavedFilterChips` on /places —
  click = `router.push(?qs)` full replace (back/forward-safe), ✨ chips
  re-run the AI pipeline via the same `useAiSearch` hook (rankings are
  session-only by design and never stored).
- **Single-place share (NF-18)**: Share2 button on place detail →
  create/reuse link → `/shared/[slug]` renders `SharedPlaceView`
  (photo, category, rating, address, hours, map pin, owner note).
  **Deliberate deviation:** the public payload is a WHITELIST of exactly
  what the view renders (id, name, address, city, country, notes,
  category name+color, location, and google_data limited to photo,
  rating, ratings count, hours, website, maps URL) — owner-personal
  fields (user_id, rating, visit_status, booked_at/visited_at, source,
  timestamps) and reviews/place_profile never leave the server.
  "Save to my places" copies with dedupe by google_place_id.
- **Review fixes (28/28 adversarial findings addressed):**
  - **HIGH:** `POST /api/shared/[slug]/save` read the ORIGINAL content
    with the visitor's cookie client — owner-scoped RLS 404'd every
    cross-user save **since April** (savePlace + pre-existing
    saveList/saveTrip). Originals now read via `createServiceClient()`;
    INSERTs stay on the cookie client (RLS WITH CHECK enforces owner).
    Together with the `source` CHECK widening this makes save-to-account
    actually work for the first time.
  - `POST /api/shared` now reactivates a deactivated existing link
    instead of returning a dead URL. Revocation UI still missing —
    tracked as v4 PART 4 #14.
  - Saved filters polish: Enter-key in-flight guard, AI-chip error
    toast, `Place.source` type union += similar/shared, stale-comment
    fixes; debounce-revert + stale-taxonomy-ID edges documented as
    accepted.
- Docs: new `schema/saved_filters.md`; rls-policies (saved_filters row
  format), shared_links (place CHECK, FK no-cascade note, reactivation),
  places schema + domain (source enum similar/shared),
  api-routes/shared (place branch + two-client save), share-flow +
  sharing (place branch, whitelist, RLS fix), use-shared-links (unions),
  ai-search-flow (chip trigger), hooks/schema indexes, routing,
  repo-structure, v4 doc (0.4 canlı durum + PART 4 #14).

## 15.07.2026 — v1.19.0 — S2-PR1: place comparison (F-04) + AI compare

First half of sprint S2 (v4 Tema 2). The second consumer of the
place_profile asset (the first was AI search).

- **`/places/compare?ids=…`** — side-by-side 2-4 places: rating +
  distribution (reuses `RatingDistributionBar`), price range, live
  open-now (reuses `PlaceStatusBadges`), distance from the first
  selected place (`haversineDistance` moved from trip/auto-plan.ts to
  `lib/geo.ts` — single source of truth), `theme_insights` rows aligned
  across columns (union ordered by salience), pros/cons. Entry:
  multi-select on /places → **Compare** button in BulkActionBar
  (enabled for 2-4).
- **`POST /api/ai/compare`** — feeds the STORED place_profiles (not raw
  reviews; ~$0.002/run) to Gemini → `overall` verdict + per-theme
  winners + occasion-based picks ("special dinner" → A, "casual
  weeknight" → B). parse-query gate skeleton; LLM references places by
  INDEX (v1.8.5 lesson), sanitized after parse; response echoes `order`
  so the client never trusts LLM ids. New SKU **`ai_compare`** + budget
  kind `compare`, cap `AI_MONTHLY_COMPARE_CAP = 200`/month (hardcoded
  like its siblings — caps are code constants, not env). CostTracker
  picks the SKU up automatically via the config spread.
- **`AiCompareCard`** — deliberate-click design: the LLM call fires
  ONLY on the button (never on page load) so refreshes don't burn
  budget units.
- **GET /api/places `ids` param** (cap 10) — one-round-trip fetch for
  the compare view on the list route (EWKB-safe parser + subcategory
  join).
- No DB change. No new env.

## 15.07.2026 — v1.18.0 — S1-PR2: dynamic open-now, NF-05 similar places, NF-03 topic filter, NF-04 grouped amenities

Second half of sprint S1 (v4 Tema 1) — completes place detail v2.

- **Dynamic "Open now"** (user-requested during S1-PR1 testing): the
  structured DataForSEO `timetable` (previously converted to
  weekday_text and DISCARDED) is now stored as
  `google_data.work_timetable`, alongside `google_data.tz` (IANA,
  derived once server-side from coordinates via the new `tz-lookup`
  dep — never shipped to client bundles). `src/lib/places/open-now.ts`
  computes open/closed at RENDER/FILTER time in the place's OWN
  timezone — overnight slots (18:00→02:00), 24h (open==close), null
  days and invalid-tz all handled; 15-case smoke suite (tsx, real
  module) ALL PASS incl. the same-UTC-instant Istanbul-open vs
  London-closed pair. Surfaces: **"Open now" filter chip** (panel +
  mobile sheet; `PlaceFilters.open_now` → `?open_now=true` → JS
  post-filter in GET /api/places; unknown = excluded) and the **honest
  live badge** on place detail ("Open now · closes 23:00" / "Open 24
  hours" / "Closed now") — the correct replacement for the
  crawl-snapshot badge removed in v1.17.0. Coverage grows as places
  refresh (timetable/tz only exist on rows written after this release).
- **NF-05 Similar places**: `people_also_search` (was never rendered)
  → horizontal card strip (max 6) on place detail. **Preview-first
  add** (final design after user testing): clicking a card opens
  AddPlaceDialog pre-filled with the suggestion's `?cid=` URL —
  parse-link handles CID URLs natively — so the decision happens on the
  same first-class preview as a manual add (photo, hours, lite AI
  profile + chips); save = standard POST /api/places + enrich chain
  with `source: "similar"` (new dialog prop). An interim one-click
  `/api/places/add-similar` route was built then REMOVED in favor of
  the single path. Already-in-library suggestions render "Added ✓". The
  dialog preview also shows a free **View on Google Maps** link
  (`placeData.googleMapsUrl` already came with the parse — no extra
  call) — benefits every add path, not just similar places.
- **NF-03 topic click→filter**: "People mention" chips are buttons;
  clicking filters the reviews list (case-insensitive text match) with
  an active-topic chip + count in the header, clearable; pagination
  index clamps instead of effect-resetting.
- **NF-04 grouped amenities**: new `src/lib/places/attribute-icons.ts`
  reconstructs groups from key prefixes (DataForSEO's own groups are
  flattened away at storage): Accessibility / Food & Drink / Payments /
  Atmosphere / Planning / Good to know / Facilities, each with lucide
  icons; high-signal attributes get curated icons (wifi, dog, wine…).
- **DB migration (LIVE, via Supabase MCP):**
  `widen_places_source_check_add_similar` — `places_source_check`
  CHECK widened to include `'similar'` (was
  manual/import/link/mapbox_search; caught in adversarial review — the
  insert would have failed on every add). Additive-only.
- Adversarial review (24 agents, 4 lenses): 20 findings, 20 confirmed
  (1 high = the CHECK constraint, 5 medium, 14 low) — 18 fixed, 2
  accepted with notes (dedup race — single-user + serialized client;
  DataForSEO cap absence → PART 4 #13 debt). Notable fixes: 60s
  refetch bound on the open-now list, 60s badge tick, omitUndefined in
  extractExtendedData (degraded crawl no longer strips stored keys),
  topic-filter page reset, `{}` timetable = unknown not "closed".
- **Preview-test feedback round (same day):** (a) SimilarPlaces cards
  now show `category` + compact vote count ("Bakery · ★4.8 (1.2k)") —
  both fields existed in the raw API and were DROPPED at transform;
  older rows gain them on refresh. (b) Topic chips: Google's pool-wide
  counts contradicted the local filter on screen ("scallop ceviche (5)"
  → 0 results). Chips now show the LOCAL match count using the same
  token-AND matcher the filter uses (`lib/places/topic-match.ts` —
  consistent by construction); ordering still follows Google's salience
  signal; zero-match chips render muted/non-clickable.
- Deps: `tz-lookup` (+ local d.ts — no bundled types).
- Docs: api-routes/places.md (add-similar + open_now param),
  components/places.md, components/filters.md, tech-stack, dataforseo,
  01-domain/places, repo-structure, v4 doc (Tema 1 → PR2 complete).

## 15.07.2026 — v1.17.0 — S1-PR1: place detail data layer + component refactor + NF-06 review layer

First half of sprint **S1** (v4 Tema 1 — place detail v2). Discovery
corrected the v4 status matrix: roughly half of NF-01..06 already
existed in basic form inside `places/[id]/page.tsx` (built during the
May sprint, never reflected in the roadmap). PR1 therefore focuses on
the data layer + structure; PR2 (upcoming) adds NF-05, NF-03
interaction and visual polish.

- **`current_status` extraction fixed** — the field lives at
  `work_time.work_hours.current_status` (verified against
  docs.dataforseo.com), not `work_time.current_status`. The wrong path
  meant **0/471 places** ever had it, and the detail page's status UI
  was dead code. Same fix applied to `opening-hours-adapter.ts`'s
  `open_now` derivation (also never populated). Stored places gain the
  field on their next refresh.
- **`GoogleReview` enriched (NF-06 data leg)** — `owner_answer`,
  `owner_time_ago`, `images` (≤6, direct URLs), `local_guide`,
  `votes_count` now flow through `transformReviews` → `mergeReviews`
  and persist. Field paths verified against the DataForSEO reviews
  schema. Dead `transformExtendedReviews` removed. Existing corpora
  upgrade lazily: a re-fetched copy of a known review replaces it
  in place (merge identity unchanged).
- **Detail-page refactor** — 7 widgets extracted from the 1,155-line
  client page (now 751 lines) into `src/components/places/`:
  `rating-distribution-bar`, `popular-times-widget` (now null-day
  safe — DataForSEO returns `null` for dataless days; the old cast
  hid it), `place-status-badges`, `place-action-links`,
  `amenities-grid`, `place-topics`, `reviews-section`.
  Behavior-preserving except documented fixes. Lint warnings 107→101
  (unused imports + a set-state-in-effect converted to an event-handler
  reset per react-best-practices).
- **NF-06 review layer (UI)** — review cards now show owner responses
  (indented muted block), photo thumbnails with a Dialog lightbox
  (prev/next), Local Guide chips and helpful-vote counts. All
  empty-safe: old stored reviews render exactly as before.
- Docs: `components/places.md` v1.3.0 (7 new component sections),
  `dataforseo.md`, `01-domain/places.md`, `repo-structure.md`, v4 doc
  4.2.0 (Tema 1 matrix corrected + S1 progress).

## 15.07.2026 — v1.16.0 — Langfuse LLM observability (all Gemini calls traced)

System-wide Langfuse integration: every LLM call now exports OTel gen_ai
spans to **both** Honeycomb (unchanged) and **Langfuse** (new; EU cloud).
Rides the existing OTel pipeline — `registerOTel({ spanProcessors:
["auto", langfuseSpanProcessor] })` keeps the Honeycomb export processor
and adds Langfuse alongside. No behavior change to any AI feature; zero
new AI cost (telemetry only).

- **New `src/lib/telemetry/langfuse.ts`** — `LangfuseSpanProcessor`
  singleton (skipped entirely when `LANGFUSE_PUBLIC_KEY`/`SECRET_KEY`
  are absent) + `flushLangfuse()` (error-swallowing forceFlush).
  Composed `shouldExportSpan`: the default filter keeps Langfuse
  LLM-only (no infra spans), PLUS the AI SDK's outer umbrella spans
  (`…:ai.generateText`) are dropped — **found in live testing**: the
  umbrella loses its input/output token attributes in emission (AI SDK
  v6 `totalUsage` aggregation bug) but keeps `reasoningTokens`, so
  Langfuse priced reasoning tokens twice (~37% trace-cost inflation —
  e.g. the first live search showed $0.0321 instead of the true
  $0.0235). The `…doGenerate` child carries complete usage + full
  message IO; costs now match reality. Filter verified with a 7-case
  functional test through a real processor + fake exporter.
  **The singleton is stashed on `globalThis` via `Symbol.for`** — found
  in adversarial review: Turbopack compiles the instrumentation hook and
  the routes into disjoint bundle graphs, each evaluating the module
  separately; a plain module-level instance would leave the routes
  flushing a never-registered second copy (silent no-op).
- **`generate-profile.ts` gains `experimental_telemetry`** (span
  `ai.generate-profile`, metadata userId+placeId) — was the one LLM call
  site without it. parse-query/rank-results already had theirs.
- **Langfuse trace-level fields** via `propagateAttributes` at all three
  call sites: `ai-search` (parse-query + rank-results — traceparent
  propagation merges them into ONE Langfuse trace), `place-profile`
  (enrich `step=profile`), `cron-refresh-places` (refresh cron, tag `cron`).
- **Serverless flush:** parse-query, rank-results, enrich and the cron
  route call `after(flushLangfuse)` (`next/server`) so the span batch
  survives Vercel's freeze-after-response.
- **Env** (already set in Vercel; local `.env.local.example` updated):
  `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
  Connectivity verified pre-implementation with a test trace
  (`langfuse-connectivity-test`, trace `700fca39…`) confirmed via the
  Langfuse API.
- **Deps:** `@langfuse/otel` + `@langfuse/tracing` `^5.9.1`.
- Docs: `observability-flow.md` v3.3.0 (architecture diagram + env table
  + "four places to look" + diagnostic toggles), `env-vars.md` v1.3.0
  (canonical list now truly canonical — added the missing `CRON_SECRET`
  + `HONEYCOMB_*` rows too), `tech-stack.md` v1.3.0 (new Observability
  section), `monitoring.md` v1.1.0 (was pre-Honeycomb stale),
  `repo-structure.md` v1.2.1 (lib/telemetry/ tree), telemetry notes in
  `api-routes/ai.md`, `api-routes/places.md`, `ai-search-flow.md`,
  `ai-enrichment-flow.md`, `full-profile-flow.md`,
  `runbooks/periodic-refresh.md`, `gemini.md`, `01-domain/places.md`,
  `manual-place-create-flow.md`, v4 doc 5.2 decision record.

## 15.07.2026 — v1.15.1 — CRITICAL: profile prompt was truncating review i to i characters

Found while inspecting the first Langfuse traces (the prompt is finally
visible!): the full-profile prompt's REVIEWS section showed review 0 as
empty, review 1 as 1 char, review 2 as 2 chars… — a perfect
index-length staircase.

- **Root cause:** `place-profile-full.ts` used `.map(compactReview)` —
  `Array.map` passes `(element, index, array)`, and the index silently
  bound to `compactReview(r, maxChars = …)`'s second parameter. Review
  *i* was `slice(0, i)`-truncated. The classic `map(parseInt)` foot-gun.
- **Since when:** Phase 4 day one (19.05.2026, `90cac35`). The v4
  overhaul (926da4c) only changed the default 400→1000 — the bug
  predates it.
- **Blast radius: ALL 451 full profiles** (448 `gemini-flash-latest`,
  3 `gemini-3-flash-preview`) were generated from near-empty review
  text. The LLM fabricated fluent profiles from place_topics,
  DataForSEO attributes, rating distribution and the lite prior —
  including plausible-but-invented "evidence quotes". Profile quality
  silently degraded; nothing crashed, so it was invisible until
  Langfuse exposed the raw prompt.
- **Fix:** `.map((r) => compactReview(r))` + a warning comment.
  Regression-tested by importing the real module (tsx): 8/8 long
  reviews now appear in full; no truncated lines.
- **Follow-up (v4 PART 4 #8 updated → 🔴):** every existing profile
  needs regeneration — the re-profile cohort is now the whole library,
  not just the old-model rows. ~451 × ~$0.01 ≈ ~$5, fits the monthly
  profile budget (1000).
- LLM-reported `generated_at`/`model_version` in the output are ignored
  (server stamps its own — verified) so no stored metadata corruption.

## 15.07.2026 — v1.15.0 — S0 maintenance: dependency batch, ESLint-10 unblock, legacy import removal

Sprint **S0** from the v4 roadmap. Clears the two red maintenance items
(PR #61, broken ESLint) and removes a dead route so the tree is green
end-to-end (`tsc` + `next build` + `npm run lint` all exit 0).

- **Dependency batch (supersedes dependabot PR #61).** Re-applied #61's
  minor-and-patch group fresh on `main` — #61's branch was stale (based on
  04.07; `main` has since advanced to v1.14.1): `next` 16.2.6→16.2.10,
  `react`/`react-dom` 19.2.6→19.2.7, `@base-ui/react` 1.4.1→1.6.0,
  `lucide-react` 1.16→1.23, `@tanstack/react-query` 5.100→5.101,
  `@supabase/ssr` 0.10.3→0.12.3, `mapbox-gl` 3.23→3.25, `recharts` 3.8→3.9,
  `date-fns` 4.1→4.4, `@opentelemetry/{sdk-logs,exporter-logs-otlp-http}`
  0.219→0.220, `@vercel/otel` 2.1.2→2.1.3, `shadcn`, `zustand`,
  `eslint-config-next` 16.2.6→16.2.10. **Close PR #61 as superseded.**
- **Fixed the two build breaks the bump introduced** (the reason #61's
  preview failed): (1) the group dropped the transitive `@types/geojson`, so
  `GeoJSON.FeatureCollection` in `map-view.tsx` stopped resolving — declared
  `@types/geojson` explicitly + switched to
  `import type { FeatureCollection } from "geojson"`; (2)
  `@opentelemetry/sdk-logs` ≥0.220 changed `BatchLogRecordProcessor` to a
  single options object — `instrumentation-node.ts` now passes `{ exporter }`.
- **ESLint 10 unblocked.** Root cause: `eslint-plugin-react@7.37.5` (bundled
  by `eslint-config-next`) calls the removed `context.getFilename()` during
  React-version detection → crashed project-wide on ESLint 10. Fix in
  `eslint.config.mjs`: pin `settings.react.version` to `"19.2"` (skips
  detection entirely) + ignore `.claude/**` (stop descending into worktree
  checkouts).
- **Lint baseline established (pragmatic, user-approved).** Fixing the crash
  surfaced 81 errors it had always masked. Fixed the trivial ones
  (`prefer-const`, `react/no-unescaped-entities` ×2,
  `@next/next/no-html-link-for-pages`) and removed 5 dead
  `eslint-disable no-console` directives. Deferred as **tracked tech debt**
  (downgraded to `warn` — see v4 PART 4): 49 `@typescript-eslint/no-explicit-any`
  (pre-existing) + 28 `react-hooks/*` from the newly-pulled
  `eslint-plugin-react-hooks@7` React-Compiler rules (`set-state-in-effect`,
  `preserve-manual-memoization`, `refs`, `use-memo`, `purity`). Result:
  **0 errors, 107 warnings, exit 0.**
- **Removed legacy `POST /api/places/import`** (v4 PART 4 #5). The v1
  NDJSON-streaming single-shot importer, dormant since the client-driven
  `import-parse` + `import-batch` redesign; zero code references. Docs
  updated: `api-routes/places.md`, `01-domain/places.md`,
  `place-import-flow.md`, `google-places.md`, `dataforseo.md`, `deployment.md`.
- **Behavior-neutral source touches** (documented behavior unchanged, logged
  for the record): `map-view.tsx` type-import swap, `auto-plan.ts` `let`→`const`,
  `logger.ts` + `use-ai-search.ts` dead-comment removal.
- Docs: `tech-stack.md` v1.2.0 (dep version table + ESLint config note),
  `observability-flow.md` v3.2.0 (BatchLogRecordProcessor options object),
  `feature-suggestions_v4.md` v4.1.0 (S0 done; PART 4 debt updated).

## 15.07.2026 — v1.14.2 — Post-deploy fixes from live v4 testing

Three issues surfaced testing #62 on the live deploy:

- **Cron 307-redirected to `/login`** (never ran). `src/lib/supabase/middleware.ts`
  now exempts `/api/cron/*` from the session-redirect — the cron has no cookie
  (Vercel sends `CRON_SECRET` as a bearer) and authenticates itself. Doc:
  `05-flows/auth-flow.md` v1.1.0.
- **Cost tracker omitted every AI SKU.** `getMonthlyUsage` iterated only the
  Google `SKU_CONFIG`; the `ai_*` SKUs live in `AI_SKU_CONFIG` and were dropped
  from the display even though the rows exist. Now merges both registries.
  (Estimated cost uses the current config price, so AI lines show Gemini 3
  rates going forward; historical rows keep their stamped `cost_per_1k`, which
  the display doesn't read.)
- **AI summary refresh failed silently.** `AiSummaryCard` now toasts the
  server's reason on failure (LLM error / not configured / budget) instead of
  a bare `console.error` — makes summary-generation failures visible and
  diagnosable. (Investigating a separate report that manual refresh isn't
  regenerating the profile on the live deploy — model id `gemini-3-flash-preview`
  is verified valid; root cause pending a live signal.)

## 15.07.2026 — v1.14.1 — Vault consistency sweep (post-v4)

Documentation-only audit closing gaps left across the day's code changes.

- **Structural docs caught up:** `repo-structure.md` v1.2.0 (new `/api/cron/`
  route group, `src/lib/places/`, `generate-profile.ts`, route count);
  `api-routes/_README.md` v1.4.0 (Cron group; the RLS convention now carves
  out the service-role/cron exception — those paths MUST filter by
  `user_id`; service-role client list + helper table + count updated).
- **Stale facts fixed:** `full-profile-flow.md` daily→monthly cap +
  `generate-profile.ts` in sources; `gemini.md` review-input line
  (400→1000 chars + 35/15 blend); `ai_suggestions_queue.md` source_model
  example; `04-integrations/_README.md` "NL search (planned)" → shipped +
  `ai_parse_query`/`ai_rank_results` SKUs; `dataforseo.md` v1.1.0
  (`fetchReviews` sort_by + refresh merge/chain); `places.md` route
  description; `ai-enrichment-flow.md` sources.
- **New surfaces documented:** `users-and-profiles.md` v1.2.0
  (`cron_refresh_enabled`); `components/places.md` v1.2.0 (AiSummaryCard
  `reviews` prop + staleness badge).

## 15.07.2026 — v1.14.0 — Periodic refresh cron (AI-22 v1) + Gemini 3 pricing true-up

The systemic answer to profile staleness: a daily sweep keeps Google data
and AI summaries fresh without manual refreshes.

- **`GET /api/cron/refresh-places`** (new) — daily Vercel Cron
  (`vercel.json`, 03:00 UTC, `CRON_SECRET`-guarded). Picks the 14 stalest
  places (`google_data->>enriched_at` missing/older than 30 days), runs a
  full DataForSEO re-lookup with newest-sorted review merge, and
  regenerates the profile **only when genuinely new reviews arrived** (or
  none existed). Runbook: `06-ops/runbooks/periodic-refresh.md`.
  **Setup required: add `CRON_SECRET` env var in Vercel.**
- **Service-client-safe extractions** so the cron shares the exact
  interactive logic: `src/lib/places/refresh-google-data.ts` +
  `src/lib/ai/generate-profile.ts`; the refresh + enrich?step=profile
  routes are now thin HTTP shells (response shapes unchanged). All queries
  filter by userId explicitly; `trackUsage`/`trackAiUsage`/`checkAiDailyCap`
  accept an injected client.
- **Gemini 3 pricing true-up** (verified ai.google.dev): $0.50/$3.00 per
  1M in/out — ~7-10× the 2.5-era assumptions. `AI_SKU_CONFIG` updated
  (parse $0.70/1k, rank $20/1k, profile $9.5/1k) so CostTracker shows
  real numbers; docs updated (`gemini.md`, `ai-search-flow.md`,
  `full-profile-flow.md`).
- **AI budgets: two monthly buckets** (user decision, following the price
  verification — searches dominate cost). `checkAiBudget(kind)` replaces
  the single cap; calendar month (UTC), resets on the 1st:
  - **SEARCH** — 500 searches/month, ONE unit per search (charged at
    parse; rank rides free behind a 3× rerank-loop backstop). Ceiling ≈
    $10.5/month.
  - **PROFILE** — 1000 generations/month across the add-chain, manual
    refresh, backfill, and cron. Ceiling ≈ $9.5/month; a full ~470-place
    backfill now fits in one month.
- **The whole sweep is opt-in per user + re-profiling is thresholded.**
  New `profiles.cron_refresh_enabled` (migrations
  `add_cron_reprofile_enabled_to_profiles` +
  `rename_cron_reprofile_to_cron_refresh`, default **false**) surfaced as
  Settings → AI → "Background data refresh" (`/api/user/ai-settings`
  GET/PUT extended; toggle independent of the AI master since the data
  half isn't AI). Non-opted-in users are never scanned — no DataForSEO
  cost, no writes. Within the sweep, a profile regenerates only past
  `CRON_REPROFILE_MIN_NEW_REVIEWS` (>15 new reviews; reviewed-but-
  profileless places regenerate regardless) and only when the owner has
  `ai_features_enabled`.
- **Backbone refresh cycles.** During January and July (UTC,
  `BACKBONE_REFRESH_MONTHS`) the sweep fetches `sort_by:"relevant"`
  instead of `"newest"`, letting Google's current relevance ranking
  rebuild each place's backbone tier twice a year.
- **Hardening from a 24-agent adversarial review** of the whole change
  set (19 confirmed findings across 8 distinct defects, all fixed):
  - `mergeReviews` was destroying the relevance order on INITIAL
    population (empty existing → relevant fetch got re-sorted
    newest-first) and letting legacy heads squat the backbone — now
    mode-aware: `incomingOrder:"relevant"` fetches ESTABLISH/refresh the
    backbone; `"newest"` fetches feed the pool.
  - `newReviews` was a length delta → read 0 at the 200-cap, permanently
    disabling cron re-profiling for busy places → now a key-diff
    (`countNewReviews`).
  - Cron staleness marker moved to always-stamped
    `google_data.refresh_attempted_at` (biz-info-dead places no longer
    starve the daily batch) + `bizInfoFailed` surfaced in the summary.
  - 240 s soft deadline: workers stop picking places in time for the
    summary/log to emit (a 14-place batch could exceed `maxDuration`).
  - PostgREST `or()` values are now double-quoted (backslash-escaping
    commas is invalid PostgREST syntax) — fixes comma-containing search
    AND the pre-existing city-filter variant of the same bug.
  - Reviews SKU tracked even on zero-result fetches (the task is billed
    regardless); staleness badge timestamp parsing made Safari-safe;
    residual `gemini-flash-latest` refs swept from tech-stack/glossary/
    flow docs.

## 15.07.2026 — v1.13.0 — Gemini 3 Flash Preview + two-tier review corpus + summary reach

AI content freshness & search-reach bundle, follow-up to the v4 review.

- **Model → `gemini-3-flash-preview`.** `FLASH_MODEL` / `MODEL_VERSION`
  upgraded from `gemini-flash-latest` (2.5 family). Id verified against
  Google's own pricing docs — note the namespace split: the Generative
  Language API (our direct provider) uses `gemini-3-flash-preview`, while
  the Vercel AI Gateway catalog normalizes the same model as
  `google/gemini-3-flash`. Old profiles keep their old `model_version`
  stamp → natural re-profile cohort.
- **`searchable_summary` 150-250 → 250-400 words** (profile prompt rule 7 +
  schema comment); rank-results `SUMMARY_CHAR_CAP` 1500 → 3000.
- **Two-tier review corpus (merge, not replace).** New `mergeReviews` in
  `dataforseo/transform.ts`: the first ≤50 stored positions are the
  relevance-ordered **backbone** from the initial `sort_by:"relevant"`
  fetch (never reshuffled/evicted — the quality floor), followed by a
  rolling newest-first **pool** (total cap 200). All three review-write
  sites merge, mode-aware: `"relevant"`-sorted fetches (initial enrich,
  bulk import) establish/refresh the backbone; `"newest"`-sorted refresh
  fetches feed the pool. The profile prompt blends **35 backbone + 15 freshest**
  (`selectReviewsForPrompt`) — never "newest 50" alone, since recency ≠
  signal quality.
- **Refresh → profile chain.** `refresh-google-data` regenerates the AI
  summary after a successful refresh (fire-and-forget chain, mirroring
  enrich). Covered by the AI cost cap.
- **Staleness badge.** `AiSummaryCard` shows an amber hint when the newest
  stored review post-dates `place_profile.generated_at` (safety net — the
  chain normally regenerates automatically).
- **Keyword search reach.** `/api/places?q=` ILIKE now also covers
  `place_profile.searchable_summary` + `tldr` (PostgREST `or()` with JSONB
  paths — syntax smoke-tested against live REST). The search term is now
  `%`/`,`-escaped.
- Docs: `gemini.md`, `api-routes/ai.md` v1.3.0, `api-routes/places.md`
  v1.1.0, `full-profile-flow.md`, `ai-enrichment-flow.md`,
  `place-import-flow.md` v1.1.1.

## 14.07.2026 — v1.12.1 — Profile prompt: review input cap 400 → 1000 chars

`compactReview` in `src/lib/ai/prompts/place-profile-full.ts` now keeps up
to 1000 chars per review (was 400) — long-form reviews carry the richest
signal for `searchable_summary` and `theme_insights` and were being cut too
early. Worst-case profile input grows ~5K → ~12.5K tokens (~$0.001/profile
→ ~$0.002); typical is lower since most reviews are short. Applies to
future generations only — existing profiles keep their summaries until
re-profiled. Docs: `full-profile-flow.md` v1.2.0, `gemini.md` v1.2.1.

## 14.07.2026 — v1.12.0 — Feature roadmap v4

New `_plans/feature-suggestions_v4.md` — the canonical roadmap, superseding
the three archived v2/v3 docs. Written after a ~2-month pause, on a full
review of the archived roadmaps against the May 2026 AI sprint (PR #28–#49).

- **Status sync**: everything implemented through v1.11.0 marked done —
  AI-01 (as LLM-as-judge), AI-03/04/05, partial AI-06/F-01/AI-08/AI-28,
  plus off-roadmap wins (sub-categories, moderation queue, backfill,
  observability, cost cap).
- **Decision records**: Gemini-direct over Claude/Gateway, soft-features →
  judge pivot, embeddings deferred, collaborative/social/premium shelved.
- **Re-priced backlog**: NF-01..06 DataForSEO visualization package as the
  P1 quick-win theme; comparison (F-04 + AI compare) as the second consumer
  of the place_profile asset; AI-02 assistant re-estimated cheaper (~5-7d)
  given existing tool routes.
- **Sprint plan S0–S5** + tech-debt register (PR #61 preview failure,
  broken ESLint, grandfather re-enrich → data-quality agent).
- Numbering: v3 F-xx/AI-xx canonical; NF-xx kept as its own series;
  v3-ai-first's conflicting AI numbers mapped in an appendix.

## 20.05.2026 — v1.11.0 — AI daily cost cap + enrichment-flow doc (Phase 7 close)

Phase 7 closeout — a per-user daily cost cap on AI calls, and the missing
AI-enrichment overview doc.

- **Daily cost cap (F5).** `checkAiDailyCap` + `AI_DAILY_CALL_CAP = 3000`
  in `src/lib/ai/track-usage.ts` — sums today's AI-SKU counters in
  `api_usage`. The three AI routes — `parse-query`, `rank-results`, and
  `enrich?step=profile` — return **429** before calling Gemini once a user
  hits the cap. Runaway-bug insurance: ~3× a realistic heavy day, fails
  open on a check error, never gates `step=info` / `step=reviews`
  (DataForSEO, not AI). AI search surfaces the 429 as a toast.
- **`05-flows/ai-enrichment-flow.md` (F4).** New overview doc — the
  `enrich` cascade (`info → reviews → profile`), the per-entry-point
  asymmetry (manual create auto-runs the full cascade; bulk import needs
  the backfill), the completeness ladder, and the cost cap, in one place.
- Docs updated for the cap: `api-routes/ai.md`, `gemini.md`,
  `full-profile-flow.md`, `ai-search-flow.md`, `05-flows/_README.md`.
  `api-routes/places.md` + `manual-place-create-flow.md` patch-bumped
  (enrich/route.ts touched in `step=profile`, outside their documented
  scope — no content change).

## 20.05.2026 — v1.10.2 — Import done screen surfaces the AI profile backfill

The bulk-import "done" screen now renders the shared `BackfillProfilesPanel`
(from Settings → AI) once background review enrichment settles. Imported
places have reviews + CID by then, so one click runs the cheap `step=profile`
backfill for them — closing the gap where bulk-imported places never received
an AI `place_profile`.

- `src/app/(app)/import/page.tsx` — renders `<BackfillProfilesPanel />` as a
  sibling of the done card, gated on `phase === "done" && !reviewsEnriching`.
- No new component / hook / route — reuses PR #42's panel end-to-end.
- `05-flows/place-import-flow.md` v1.1.0 — step 9 + explanatory note.

## 20.05.2026 — v1.10.1 — Docs: deferred backfill re-enrichment plan

Captured a known limitation of the AI `place_profile` backfill and a deferred
fix plan, after diagnosing thin profiles on a grandfather account.

- New `_plans/backfill-grandfather-reenrich.md` — accounts predating the full
  DataForSEO migration hold places with ≤5 reviews + no CID; the backfill
  profiles them thinly (5-review summaries, empty `theme_insights`). Verified
  DB diagnosis + a 3-change fix plan. Status draft / **deferred** — new
  DataForSEO-era data is unaffected; only ~1-2 legacy accounts carry this.
- `06-ops/runbooks/profile-backfill.md` v1.1.0 — new "Known limitation —
  grandfather accounts" section linking to the plan.

No code change.

## 20.05.2026 — v1.10.0 — AI search pipeline trace propagation

The AI search pipeline's three browser-initiated calls — `parse-query`
→ `/api/places` → `rank-results` — now share one W3C trace context, so
Honeycomb shows the whole flow as a single trace / waterfall instead of
three disconnected ones.

- New `src/lib/telemetry/trace-context.ts` — `newTraceparent()` mints a
  W3C `traceparent` (`00-<trace-id>-<span-id>-01`) per AI search.
- `ai-search-store.ts` — new `traceparent` field + `setTraceparent`
  action; cleared on `applyRankings` / `failRerank` / `reset` and on
  no-rerank parses so it never leaks onto unrelated fetches.
- `use-ai-search.ts` — mints the traceparent at search start and sends
  it on the parse-query and rank-results fetches.
- `use-places.ts` — `fetchPlaces` attaches the active search's
  traceparent so `/api/places` joins the same trace.
- No server change: `@vercel/otel` continues the trace from the
  incoming header via its default W3C Trace Context propagator.

Telemetry-only — no behaviour change to search, filters, or ranking.
The browser-side root span is synthetic; a real exported browser span
remains a future add.

Docs: `observability-flow.md` v3.1.0, `ai-search-flow.md` v2.4.0,
`use-places.md` v1.1.0.

## 20.05.2026 — v1.9.0 — Observability: dual-write (Honeycomb + Vercel/Axiom)

OpenTelemetry observability with a **dual-write** log pipeline. Traces
go to Honeycomb; logs go to BOTH stdout (Vercel dashboard + Axiom drain)
AND Honeycomb. Two log pipes with independent failure modes — a
misconfigured backend can never black out monitoring.

### Why Honeycomb for traces

Initially targeted Axiom. Axiom's free tier caps datasets at 2, one slot
taken by the system `axiom-audit` dataset — no room for a `Kind: Traces`
dataset, which OTLP traces require. OTLP traces to the Events-kind
`vercel` dataset were silently dropped. Honeycomb: OTel-native, no
dataset limit (20M events/mo, 60-day retention).

### Why dual-write for logs (post-mortem)

An intermediate cut rewrote the logger to emit ONLY OTel log records and
gated `console.log` to dev. The OTel Logs API never touches stdout — so
that deploy instantly killed the Vercel dashboard Logs view AND the
Axiom drain, while Honeycomb wasn't receiving anything either (env-var
timing). Total blackout from a hard cutover to an unverified pipe.

Fixed per the otel-migration skill's explicit rule (Phase 5: logs to
BOTH stderr AND OTel). `logger.ts` now writes every call twice:
- `console.log`/`console.warn` JSON line → stdout → Vercel dashboard +
  Axiom Log Drain (`vercel_parsed` view's `parse_json` surfaces fields)
- `logs.getLogger().emit()` → OTel pipe → Honeycomb `/v1/logs`

The console pipe needs no env vars and is captured synchronously by
Vercel — the always-on safety net. The OTel pipe is best-effort on top.

### Architecture

`instrumentation.ts` → gated by `NEXT_RUNTIME === "nodejs"` (the OTel
log packages are Node-only; importing them in the Edge runtime crashed
middleware — see the MIDDLEWARE_INVOCATION_FAILED hotfix). It
dynamic-imports `instrumentation-node.ts`, which registers `@vercel/otel`
with:
- `OTLPHttpJsonTraceExporter` → Honeycomb `/v1/traces`
- `BatchLogRecordProcessor(OTLPLogExporter)` → Honeycomb `/v1/logs`

Trace sources: HTTP spans + fetch spans (auto) + `gen_ai.*` LLM spans
from AI SDK `experimental_telemetry` on `generateText` (model, prompt,
completion, tokens, latency, finish_reason).

### What's new

- `instrumentation.ts` (root) — runtime-gated dynamic import.
- `instrumentation-node.ts` (root) — Node-only OTel registration +
  boot diagnostic.
- `src/lib/telemetry/logger.ts` — `log.{debug,info,warn,error}`,
  dual-write. `write()` fully `try/catch`-guarded so telemetry can
  never throw into a request.
- `src/app/api/ai/parse-query/route.ts` — `experimental_telemetry`
  enabled; diagnostic + error → `log.*`.
- `src/app/api/ai/rank-results/route.ts` — same, plus structured warn
  events (`out_of_range_idx`, `duplicate_idx`, `skipped_candidates`,
  `salvaged`).
- `src/app/api/places/route.ts` — `api.places` structured event.

### Required env vars (Vercel — Production + Preview)

| Env var | Default |
|---|---|
| `HONEYCOMB_API_KEY` | (required for the OTel pipe) |
| `HONEYCOMB_DATASET` | `map-organiser` |
| `HONEYCOMB_API_URL` | `https://api.honeycomb.io` (US); `…eu1…` for EU |

When the key is absent the console pipe still works fully — only the
Honeycomb pipe is dark. Vercel applies env vars only to deployments
built AFTER they were added — a fresh deploy/Redeploy is required.

The Axiom Vercel Log Drain may stay enabled (~$1–2/mo at F&F volume) —
it is the structured-log search surface. Disabling it is optional.

### Packages

- `@vercel/otel`, `@opentelemetry/api`
- `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http`

### Files

- `src/instrumentation.ts`, `src/instrumentation-node.ts` (new — MUST
  be in `src/` since the project uses a src directory; a root-level
  instrumentation.ts is silently ignored by Next.js)
- `src/lib/telemetry/logger.ts` (new)
- `src/app/api/ai/{parse-query,rank-results}/route.ts`
- `src/app/api/places/route.ts`
- `docs/05-flows/observability-flow.md` (new, v3.0.0)

### Known follow-up

OTel log pipe uses `BatchLogRecordProcessor`; verify post-deploy that
`@vercel/otel` flushes it on Vercel's freeze-after-response — if
Honeycomb log counts lag the console/Axiom counts, switch to
`SimpleLogRecordProcessor`. Dual-write means this can't black out
monitoring regardless.

---

## 19.05.2026 — v1.8.9 — Cleanup: log gating + vault catch-up

Post-merge cleanup of the Phase 6.5 LLM-as-judge pivot (v1.8.0 → v1.8.8).

### Log gating

Verbose client-side orchestrator logs (`[ai-search/parse]`,
`[ai-search/broaden]`, `[ai-search/rerank]`) and window store exposures
(`window.__aiSearchStore`, `window.__filterPersistStore`) are now gated:

- ON in development (`NODE_ENV !== "production"`)
- ON in any environment if `localStorage["ai-debug"] === "1"`
- OFF in production / Vercel preview by default

To debug a deployed build:
```js
localStorage.setItem("ai-debug", "1");
location.reload();
```

Server-side logs (`[ai/rank-results]`, `[ai/parse-query]`, `[api/places]`)
are unaffected — always on, visible in Vercel logs.

### Vault catch-up

`docs/05-flows/ai-search-flow.md` → v2.3.0:
- Added sections for v1.8.3 (schema resilience), v1.8.4 (skipped /
  hallucinated handling), v1.8.5 (cross-page state + LLM idx refs),
  v1.8.6 (Suspense boundary), v1.8.7 (orchestrator on /places),
  v1.8.8 (filter-persist store).
- New **Mount contract** table: documents the coupled relationship
  between `<FilterPanel>` (which contains `<AISearchInput>`) and
  `useAiRerankOrchestrator(filters)`. Both must be present on the
  same page; missing one creates a stuck-pending UI. (This was the
  v1.8.7 bug — orphan AISearchInput on /places.)
- New **Diagnostic logging** section: documents the `localStorage`
  toggle.

### Files touched

- `src/lib/hooks/use-ai-search.ts` — `isOrchLogEnabled()` helper
- `src/lib/stores/ai-search-store.ts` — gated window expose
- `src/lib/stores/filter-persist-store.ts` — gated window expose
- `docs/05-flows/ai-search-flow.md` → v2.3.0

### No behavior change for end users

---

## 19.05.2026 — v1.8.5 — Cross-page state + LLM idx references

Three UX/correctness fixes observed during /places page testing:

### #1 + #2 — Cross-page state persistence (UX)

Going /map → /places via the sidebar dropped the URL query string, so
filters (`?city=London&...`) disappeared. AI store survived (zustand
singleton) but useFilters now returned an empty filter set:
- FilterPanel "Clear" button hidden (`hasActiveFilters=false`)
- `/api/places` returned ALL user places (no filter)
- AI-ranked places appeared at top, then every other unranked place
  below — chaotic mixed list

Separately: AISearchInput's input field is local `useState`, so the
search text appeared empty on /places even with `lastQuery` set in the
store. Confusing — the chip below said "AI search: '<query>' · ranked"
but the input was blank.

**Fix:**
- `src/components/layout/app-sidebar.tsx` — Map + Places sidebar items
  now preserve `useSearchParams().toString()` on navigation. Logo link
  (→ /map) preserves too. Lists / Stats / Import / Settings unchanged
  (no filter context). Mobile already needed this for place-detail
  drill-down → back-to-map round-trip.
- `src/components/search/ai-search-input.tsx` — new `useEffect` syncs
  `draft` (local input state) with `lastQuery` (store). Mount/remount
  picks up the live AI search; `reset()` clears both (so FilterPanel's
  "Clear" button now also empties the input box, not just the URL).

### #3 — LLM idx references (UUID copy errors → structurally impossible)

Observed v1.8.4 server log on a fresh rerank:
```
LLM skipped 1/25 candidate(s): Bistro Freddie (c73423aa-c740-...)
LLM hallucinated 1 id(s): 16b91296-dff2-...
```

The "hallucinated" UUID was one hex character off from a real candidate
UUID — strong evidence the LLM was mistyping rather than truly making
something up. 36-char UUIDs × 25 candidates = 900 chars to copy per
request; typo rate scales linearly.

**Fix — server-side LLM contract change. Client unchanged.**

- `src/lib/ai/schemas/rank-results.ts`:
  - New `LlmRankSchema` (internal): `{ idx: number, score, why }`.
    Idx is preprocess-coerced from string→int for resilience.
  - `RankResultsSchema` (public): unchanged, still `{ id: uuid, ... }`.
- `src/lib/ai/prompts/rank-results.ts`:
  - Candidate block emits `idx=0`, `idx=1`, … instead of `id=<uuid>`.
  - Output rule asks for `{ idx, score, why }`. UUID never appears
    in the prompt.
- `src/app/api/ai/rank-results/route.ts`:
  - Validates against `LlmRankSchema`.
  - Maps `idx → candidates[idx].id` server-side.
  - Detects out-of-range idx (≥N) and duplicate idx; logs WARN, drops.
  - Same skipped-candidate fill (score=0) as v1.8.4.
  - Salvage path updated to use the new schema.
  - Diagnostic log now: `candidates llm_returned safe skipped
    out_of_range duplicates with_profile hidden_below_0.20 top5`.

**Token impact:** ~37 tokens/candidate saved on input (UUID label) +
~37 on output (UUID label) ≈ ~1850 tokens saved per 25-candidate call.
~10% cost reduction per rerank.

**Reliability impact:** UUID-typo hallucinations are now structurally
impossible — an out-of-range integer is trivially detected and
rejected, vs. a 1-char-off UUID that looks valid until cross-checked
against the candidates set.

### Files touched

- `src/components/layout/app-sidebar.tsx`
- `src/components/search/ai-search-input.tsx`
- `src/lib/ai/schemas/rank-results.ts` (added LlmRankSchema)
- `src/lib/ai/prompts/rank-results.ts` (idx-based candidate block)
- `src/app/api/ai/rank-results/route.ts` (idx → id mapping)

### No DB migration. No client contract change. No breaking URLs.

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
