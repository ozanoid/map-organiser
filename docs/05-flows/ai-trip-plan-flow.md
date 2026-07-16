---
title: AI Trip Plan Flow
type: flow
domain: ai
version: 1.0.0
last_updated: 16.07.2026
status: stable
sources:
  - src/app/api/ai/trip-plan/route.ts
  - src/lib/ai/schemas/trip-plan.ts
  - src/lib/ai/prompts/trip-plan.ts
  - src/lib/places/open-now.ts
  - src/lib/trip/cost-defaults.ts
  - src/app/(app)/trips/[id]/page.tsx
related:
  - "[[trip-planning-flow]]"
  - "[[ai-enrichment-flow]]"
  - "[[../04-integrations/gemini]]"
  - "[[../02-backend/api-routes/ai]]"
---

# AI Trip Plan Flow

S4 AI-09 v1 (v1.22.0). The LLM distributes candidate places across a
trip's existing days — geo/theme grouping, per-stop time slots, per-day
theme + rationale. **Augments** the k-means auto-plan (which only
clusters by distance and never reads want_to_go); does not replace it.

## Trigger

Trip detail header → **AI Plan** button (`AiPlanButton`, gated on
`GET /api/user/ai-settings` like every AI surface) → dialog:

- Source: places already in the trip, plus opt-in **want-to-go pool**
  for a city (`include_pool` + `city`; city prefilled with the most
  common city among trip places).
- Deliberate click; dialog states the unit cost (1 plan = 1 unit,
  cap 50/month).

## Steps

1. `POST /api/ai/trip-plan` `{trip_id, include_pool?, city?}` — standard
   4-gate skeleton (auth → `ai_features_enabled` → client → budget
   `trip_plan` 429).
2. Load trip frame: `trip_days` (day_number + date), current
   `trip_day_places` rows (costs snapshotted for carry).
3. Assemble candidates (**max 40**, in-trip first): in-trip places +
   optional `queryPlaces(visitStatus: "want_to_go", city)` pool.
   Fewer than 2 → 400, nothing burned.
4. Compact projection per candidate (~350 tokens): name, category,
   coords (3dp), rating, price_level, tldr, occasions/atmosphere tags —
   **never** full profiles or raw `popular_times` (~1.8k tokens/place).
   Per-trip-day open flags precomputed server-side via `isOpenOnDate`
   (day-granular helper added to open-now.ts; unknown ≠ closed).
5. `generateText` + `Output.object(TripPlanSchema)` under
   `propagateAttributes({traceName: "ai-trip-plan"})`, functionId
   `ai.trip-plan`. Schema is **idx-referenced** (v1.8.5 lesson) with the
   compare clamp/parseInt idioms.
6. Sanitize: drop invalid day_numbers, out-of-range idx; **cross-day
   dedupe** (first occurrence wins — no DB UNIQUE constraint backs
   this). Zero usable days → 502, trip untouched.
7. **Delete-after-validate write**: only now delete all placements, then
   insert per plan — `time_slot` + per-stop `note`, `theme — rationale`
   → `trip_days.notes`. Costs carried by place_id; pool entrants seeded
   from [[../02-backend/api-routes/trips|price_level defaults]].
8. `trackAiUsage("ai_trip_plan")` + log; response = day summaries +
   placed/left_out counts + tips.

## Failure semantics

- LLM/parse failure → unit burns (compare precedent), **trip untouched**
  (nothing was deleted yet), 502 with explicit "not modified" message.
- It is FINE for the plan to leave places out — the prompt prefers
  lighter days over cramming; `left_out` is surfaced in the toast.

## Cost

Input ≈ 15-20k tokens at 40 candidates → ~$0.012/plan. SKU `ai_trip_plan`
costPer1k 12.0; monthly cap `AI_MONTHLY_TRIP_PLAN_CAP = 50`
(code constant, not env).

## Rendering

- Day theme/rationale renders under each day header (first consumer of
  `trip_days.notes`).
- `time_slot` renders as a small badge on each stop row; per-stop notes
  replace the address line in emerald italic (first consumers of the
  `trip_day_places.time_slot`/`notes` columns, which existed unused
  since the original schema).
