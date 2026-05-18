---
title: Full Profile Flow (AI Phase 4)
type: flow
domain: places
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - src/app/api/places/[id]/enrich/route.ts
  - src/lib/ai/prompts/place-profile-full.ts
  - src/lib/ai/apply-suggestions.ts
  - src/lib/ai/schemas/place-profile.ts
  - src/components/places/ai-summary-card.tsx
  - src/app/(app)/places/[id]/page.tsx
related:
  - "[[lite-profile-flow]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../02-backend/schema/ai_suggestions_queue]]"
  - "[[../02-backend/schema/subcategories]]"
  - "[[../04-integrations/gemini]]"
---

# Full Profile Flow (AI Phase 4)

The **first real LLM call** in the app. After reviews land for a place, a
background pipeline triggers Gemini Flash to produce a structured
`place_profile` (TLDR, pros, cons, theme insights, refined features). The
profile is the pivot data layer for all downstream AI features (Phase 5
moderation, Phase 6 NL filtering, future ranking/discovery).

## Trigger

`POST /api/places/[id]/enrich?step=reviews` succeeds with ≥1 review.
At the end of that handler, if `profiles.ai_features_enabled = true`, a
fire-and-forget `fetch` chains into `?step=profile` on the same place.

The user never waits for this — they save the place, see the lite profile
chips, and the full profile materializes later on the place detail page via
polling.

## Steps

```
1. User saves a place (see manual-place-create-flow / share-target-flow)
       │
       ▼ background, fire-and-forget
2. POST /api/places/[id]/enrich?step=info  (~3-4s)
       │  → google_data filled with extended fields + photo storage
       ▼
3. POST /api/places/[id]/enrich?step=reviews  (~30s)
       │  → google_data.reviews populated (50 reviews)
       │
       ▼ NEW (Phase 4)
4. Reviews handler chains into step=profile (fire-and-forget):
       │  • SELECT profiles.ai_features_enabled — if false, skip
       │  • fetch /api/places/[id]/enrich?step=profile with same cookies
       │
       ▼
5. step=profile handler:
       │  a. Re-check ai_features_enabled (defense in depth)
       │  b. getAiClient() — null if GOOGLE_GENERATIVE_AI_API_KEY missing → 503
       │  c. Bail if no reviews (defensive — chain only fires when reviews exist,
       │     but a manual call from the AI Summary refresh button might not)
       │  d. SELECT place full row + buildUserContext(user.id)
       │  e. buildPlaceProfilePrompt(place, context, lite_profile)
       │       → systemPrompt + userPrompt (English, strict-JSON instructions,
       │         user entity IDs inline, subcategory dictionary per parent)
       │  f. generateText({
       │       model: google('gemini-flash-latest'),
       │       output: Output.object({ schema: PlaceProfileSchema }),
       │       system, prompt
       │     })
       │     → result.output typed as PlaceProfile
       │  g. Force-stamp: completeness='full', generated_at, model_version,
       │     source_review_count
       │  h. Persist into google_data.place_profile
       │  i. applyProfileSuggestions() — 3-band auto-apply (see below)
       │  j. trackAiUsage('ai_place_profile') → api_usage RPC
       │
       ▼ Meanwhile on the client…
6. /places/[id] page polls every 5s while:
       │     reviews exist AND place_profile.completeness !== 'full'
       │  When the polled response shows completeness='full', stop polling.
       │  Polling cap: 2 minutes (safety net against perpetual loops).
       │
       ▼
7. AiSummaryCard renders the full UI:
       │  • TLDR paragraph
       │  • Highlights / Watch out two-column pills (pros / cons)
       │  • Most mentioned themes — pills with sentiment emoji + count;
       │    click expands to evidence quotes
       │  • Distinctive feature pills below
       │  • Refresh button (manual re-run)
```

## Auto-apply policy (Phase 5.5 unified)

Implemented in `src/lib/ai/apply-suggestions.ts`. The dialog (Moment 1)
keeps tag/list chips opt-in, but the background (Moment 2) can't ask the
user — so it follows a confidence × existence × parent-match matrix.

**Phase 5.5 change**: the matrix now treats `category_signals.primary`
as a first-class signal that can disagree with the place's currently
assigned category. When that happens — e.g. Hackney Comedy Club saved
to "Bar & Nightlife" by lite mapping, but LLM correctly identifies it
as "Entertainment" — the proposal lands in the moderation queue as a
move (paired with the sub-cat) instead of silent-applying a sub-cat
under the wrong parent.

| LLM signal | Existing user entity match? | LLM primary vs place's current category | Action |
|---|---|---|---|
| `suggested_tags.matched_existing[]` | Yes (by construction) | — | **Silent apply** — INSERT place_tags. |
| `suggested_tags.new_proposals[]` | Fuzzy-match passes | — | **Reroute** silent apply. |
| `suggested_tags.new_proposals[]` | No match | — | **Queue** type=`tag`. |
| `suggested_lists[]` | — | — | **Ignored** (dialog-only). |
| Sub-cat slug exists under LLM target parent, conf ≥ 0.85 | Yes | **MATCH** | **Silent apply** — UPDATE `places.subcategory_id`. |
| Sub-cat slug new, conf ≥ 0.9 | No | **MATCH** | **Queue** type=`subcategory`, parent=current. |
| Sub-cat slug (existing OR new), conf ≥ 0.9 | — | **MISMATCH** + primary conf ≥ 0.85 | **Queue** type=`subcategory`, parent=LLM target, `target_category_name` set. Accept moves the place AND creates/reuses the sub-cat atomically. |
| No usable sub-cat, primary conf ≥ 0.85 | — | **MISMATCH** | **Queue** type=`category_change`, `target_category_name`=LLM primary. Accept moves the place; subcategory_id nulled (old sub-cat lived under old parent). |
| Sub-cat conf < 0.85 AND primary matches | — | MATCH | **Ignore** — too uncertain. |

The dedup helper from Phase 1 (`src/lib/ai/dedup.ts`) is the safety net under
the LLM: even if Gemini emits `"japanese-food"` and the user has `"japanese"`,
the proposal reroutes to the existing tag instead of cluttering the queue.

### Why no list silent apply

Lists are the place where AI taste and user intent diverge most often. The
LLM is strict ("this restaurant doesn't belong on a list named *Cafes*"),
the user is loose ("*London Cafes* = everywhere I like in London"). Trying
to silent-apply forces one philosophy on the other. The chip in the Add
Place dialog already surfaces the LLM's proposal at the only moment when
the user is actively curating — accepting it there is a deliberate
inclusion, ignoring it is a deliberate exclusion. Running the same
suggestion silently in the background, hours later, contradicts whichever
signal the user gave at save time and pollutes list-grouped views. So the
background pipeline:

1. **Still receives `suggested_lists`** from the LLM (the field stays on
   `place_profile` for future use: search ranking, recommendation prompts,
   etc.).
2. **Does not act on it** — `apply-suggestions.ts` has no list branch.

### Accept-time fuzzy dedup (Phase 5 patch)

Background apply runs `dedupProposals` against the user's tag list at the
moment the queue row is written. But there's a race: the user might create
a manually-matching tag **after** the queue write. Without an accept-time
dedup pass we'd happily create a near-duplicate (e.g. accepting
`"Speakeasy Vibe"` while the user already has `"Speakeasy"`).

`POST /api/user/ai-suggestions/[id]/accept` now runs `isFuzzyMatch` over
the user's current tag list before deciding whether to INSERT a new tag.
Same logic for sub-categories: the route checks both `slug` and `name`
fuzzy-equivalence against existing entries under the same parent. When a
match is found, the route reuses that entity — no duplicate row.

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 5e | place + userContext + lite_profile (optional prior) | strict-JSON Gemini prompt (~5-7K input tokens) |
| 5f | Gemini call | `PlaceProfile` typed object (completeness='full') |
| 5h | profile | `places.google_data.place_profile` written |
| 5i | profile + userContext | place_tags / list_places / places.subcategory_id mutations + ai_suggestions_queue rows |
| 6 | poll on /api/places/[id] | UI re-renders when completeness flips |

## Token budgeting

- 50 reviews × ~400 chars/review (capped in prompt builder) = ~20K input chars ≈ ~5K input tokens.
- User context + system rules ≈ ~1K tokens.
- Subcategory dictionary varies by user; ~500 tokens for 62 default subs.
- Total input: ~6-7K tokens.
- Output: ~1-2K tokens (Zod schema is generous but most fields are short).
- Gemini Flash latest has ample window; cost ≈ ~$0.001-0.002 per profile call.

## Failure modes

- **AI features disabled** → step=profile returns 403; UI never renders the card (skeleton hidden because `reviewsAvailable` check is independent of the toggle, but the chain from reviews skips, so no card materializes).
- **`GOOGLE_GENERATIVE_AI_API_KEY` missing** → 503 from step=profile. AiSummaryCard skeleton lingers until polling cap (2 min) then stops; user sees the placeholder. Acceptable in dev environments.
- **LLM throws or returns invalid JSON** → caught; 500 returned. `places.google_data.place_profile` stays `lite` (or null). Polling caps at 2 min. User can hit the Refresh button on the (lite or absent) card to retry.
- **No reviews on the place** → 400 `no_reviews`. Card stays in pending-with-message state.
- **Apply-suggestions throws mid-flight** → profile is already persisted (step 5h finished). Some suggestions may apply, some may not. Re-running step=profile is safe; junction rows are deduped by check-then-insert.
- **Same proposal queued twice** → UNIQUE INDEX `idx_ai_suggestions_unique_pending` rejects with a Postgres error, which the JS client surfaces as a thrown exception. Apply-suggestions catches it implicitly (the counter still increments — we don't distinguish "queued this run" from "already queued").
- **Realtime channel** is NOT used here. Polling every 5s up to 2 min is simpler and sufficient for the single-active-user case. A future Phase could switch to Supabase realtime if multi-tab consistency becomes a concern.

## Cost & throughput

- Per profile: ~$0.001-0.002 (Gemini Flash pricing as of May 2026).
- 500 places backfill: ~$0.50-1.00 total. Cheap.
- Tracked in `api_usage` table under SKU `ai_place_profile` (~$1.00 / 1k calls baseline).

## Manual refresh

The AiSummaryCard has a Refresh button (top-right, RefreshCw icon). It
issues `POST /api/places/[id]/enrich?step=profile` directly, bypassing the
review-chain trigger. Use cases:

- Reviews were updated and the user wants a re-summary.
- A model upgrade landed and old profiles should be regenerated.
- The first auto-run failed transiently.

The button is always visible on a full-profile card; refresh runs in
foreground (~5s spinner) and re-renders on completion.

## Related code

- **Route**: `src/app/api/places/[id]/enrich/route.ts` — `step=profile` branch + chain from `step=reviews`.
- **Prompt**: `src/lib/ai/prompts/place-profile-full.ts` — system + user prompt builders.
- **Schema**: `src/lib/ai/schemas/place-profile.ts` — Zod schema enforced by `Output.object()`.
- **Auto-apply**: `src/lib/ai/apply-suggestions.ts`.
- **Dedup**: `src/lib/ai/dedup.ts` (Phase 1 — fuzzy match safety net).
- **Context**: `src/lib/ai/context-builder.ts` (Phase 1).
- **UI**: `src/components/places/ai-summary-card.tsx`, integrated in `src/app/(app)/places/[id]/page.tsx`.
- **Polling**: detail page `useEffect` watches for `completeness === 'full'`.

## Open questions

- **Backfill** for the 458 existing places — not part of this PR. Phase 7 will ship a script (`scripts/backfill-place-profiles.ts`) that throttles ~2 req/sec through the same `/api/places/[id]/enrich?step=profile` route.
- **Model upgrades**: when Gemini Flash changes name (e.g. `gemini-flash-2.7`), profiles tagged with the old `model_version` won't auto-refresh. A future cron + selective re-run by `model_version != current` would handle this.
- **Cost guardrails**: no per-user daily cap yet. At current pricing and usage, not urgent. Add in Phase 7 if the AI usage dashboard warrants it.
- **Multilingual reviews**: the system prompt instructs the LLM to translate to English. Quality of translation isn't measured. A future eval set could catch regressions.
- **Realtime vs polling**: documented above. Switch only if multi-tab consistency becomes important.
