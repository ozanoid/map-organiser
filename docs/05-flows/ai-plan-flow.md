---
title: AI Plan Flow
type: flow
domain: ai
version: 1.0.0
last_updated: 18.11.2026
status: stable
sources:
  - src/app/api/ai/day-plan/route.ts
  - src/lib/ai/schemas/day-plan.ts
  - src/lib/ai/prompts/day-plan.ts
  - src/lib/places/open-now.ts
  - src/lib/plans/write.ts
  - src/components/plans/ai-plan-button.tsx
  - src/lib/hooks/use-plans.ts
related:
  - "[[plan-flow]]"
  - "[[ai-enrichment-flow]]"
  - "[[../04-integrations/gemini]]"
  - "[[../02-backend/api-routes/ai]]"
  - "[[../01-domain/plans]]"
---

# AI Plan Flow

The LLM distributes candidate places across a plan's existing days — geography and theme, a part of the day per stop, a theme and a short narrative per day. It **augments** Auto Plan (k-means by distance, never reads the want-to-go pool); it does not replace it.

Shipped as the AI trip planner in v1.22.0 (S4 AI-09); moved onto the plans model in v1.37.0 — the route is now `POST /api/ai/day-plan`. The usage SKU (`ai_trip_plan`), the budget kind (`trip_plan`) and the telemetry ids (`ai.trip-plan`, trace `ai-trip-plan`) keep their names so the history is one series.

## Trigger

Plan page → **AI Plan** (`AiPlanButton`, shown only when `GET /api/user/ai-settings` says enabled and available) → dialog:

- Source: the places already in the plan, plus — opt-in — the **want-to-go pool** for a city (`include_pool` + `city`; the city is prefilled with the most common one among the plan's places).
- The dialog states the cost (1 unit of 50 a month) and what happens to places the model leaves out.
- While it generates the dialog can't be dismissed, and other edits to the plan wait behind it (`useAiPlan` shares the plan's write queue — [[../03-frontend/hooks/use-plans]]).

## Steps

1. `POST /api/ai/day-plan { plan_id, include_pool?, city? }` — the standard gates: auth → `ai_features_enabled` → client → budget (`trip_plan`, 429).
2. `getPlan`. More than 14 days → 400 (the output schema holds 14).
3. Candidates, at most 40, the plan's own first. An in-plan candidate is a **stop**: one per place. A second stop of the same place, a stop without a place and a stop already done or skipped are not shown to the model and stay where they are. More than 40 places in the plan → 400 before any spend. Fewer than 2 candidates → 400.
4. Compact projection per candidate (~350 tokens): name, category, coordinates (3 dp), rating, price level, tldr, occasion / atmosphere tags — never full profiles or raw `popular_times`. Open flags per plan day via `isOpenOnDate`; **a plan without dates has no weekdays, so every flag is "unknown"** and the dialog says so.
5. `generateText` + `Output.object(DayPlanSchema)`, bounded output (5,000 tokens), up to 2 attempts — both together are one unit.
6. Sanitize: unknown day numbers and out-of-range indexes dropped, a place used once (first occurrence wins), a day listed once.
7. **Apply as one batch** (`changePlan` → `apply_plan_changes`):
   - `remove_stop` for each in-plan candidate the model left out;
   - days are named by **number** here, on purpose: the model planned "day 2, the Saturday" against that date's opening hours;
   - per day, in the model's order: `move_stop` (+ `update_stop` with the part of the day and the note) for a stop that was in the plan, `add_stop` for a place from the pool;
   - `set_day { notes: "<theme> — <narrative>" }` for planned days, `notes: null` for days that got nothing.
8. `trackAiUsage("ai_trip_plan")`; the response carries the plan afterwards plus day summaries, `placed`, `left_out`, `tips`.

## What survives

Stops are moved, not recreated: **cost, currency and an exact time survive by construction** (the trips version deleted the rows and carried the costs over by hand). A stop with an exact time keeps it — the model's part of the day is not written over it. The stop's note is replaced by the model's (or cleared).

Full-rewrite semantics, as before and as the dialog says: **a place the model leaves out is removed from the plan.**

## Failure semantics

| What fails | Unit | Plan |
|---|---|---|
| Generation or parsing (after 2 attempts) | spent | untouched — 502 |
| No usable day after sanitizing | spent | untouched — 502 |
| The batch is refused because the plan changed meanwhile (a stop removed in another tab) | spent | untouched — 409, "nothing was applied, try again" |

There is no partial write any more: the batch is one transaction. (The trips version deleted first and inserted day by day, and reported a partial write when an insert failed.)

## Provider settings

Empirical, from the 16.07.2026 matrix on a failing real input (kept as they were):

- no `responseSchema` (constrained decoding looped — 60k output tokens), `structuredOutputs: false`;
- `thinkingBudget: 0` (thinking produced broken JSON on this task);
- the prompt carries the JSON template; zod validates server-side with clamps.

**The prompt wording is unchanged for a plan with dates** ("trip", "IN-TRIP") — those settings were tuned against it. Don't reword it without re-running the matrix. Only the day lines differ for a plan without dates.

## Cost

Input ≈ 15–20k tokens at 40 candidates → about $0.012 a plan (SKU `ai_trip_plan`, 12.0 per 1,000). Cap: `AI_MONTHLY_TRIP_PLAN_CAP = 50` a month (a code constant).

## Not verified yet

The move onto plans was type-checked and the batch logic reviewed, but **no generation has been run through the new route** (it needs a signed-in session and spends a unit). First run: check the toast counts against the plan, and that a stop with an exact time kept it.
