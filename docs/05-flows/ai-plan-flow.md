---
title: AI Plan Flow
type: flow
domain: ai
version: 2.0.0
last_updated: 25.11.2026
status: draft
sources:
  - src/components/plans/plan-with-assistant.tsx
  - src/components/assistant/ask-assistant.tsx
  - src/lib/agent/subject.ts
  - src/lib/agent/describe-writes.ts
  - src/lib/agent/run-turn.ts
  - src/lib/assistant/tools/get-plans.ts
  - src/lib/assistant/tools/update-plan.ts
  - src/lib/assistant/instructions.ts
  - src/lib/places/open-now.ts
  - src/lib/plans/write.ts
  - supabase/migrations/20261125120000_plan_preview.sql
related:
  - "[[plan-flow]]"
  - "[[ai-chat-flow]]"
  - "[[../04-integrations/claude-agent]]"
  - "[[../02-backend/schema/plans]]"
  - "[[../01-domain/plans]]"
---

# AI Plan Flow

Since v1.53.0 (Phase 2, decision 6.1) the plan page hands planning to the assistant: **Plan with assistant** opens the panel with the request written and the plan attached; the assistant reads the plan, proposes the change, and the card shows the plan as it will be — saved on the user's yes, and only if the plan would still come out that way. Until v1.52.0 this was a separate Gemini call (below). Auto Plan (k-means by distance, no model) stays next to it.

## Trigger

Plan page header (not on a cancelled plan) → **Plan with assistant** (`PlanWithAssistant`, `AskAssistantButton` — shown only when the assistant can be used: AI on and the Claude key set). The panel opens with, in the composer:

- a plan with two or more places at saved places: "Bu planı günlere dağıt: yakın yerleri aynı güne koy, kapalı oldukları günlere koyma.";
- fewer: "Bu planı <the city most of its places are in> için istek listemdeki yerlerle doldur." (the old dialog's want-to-go pool and city, as words);

and the plan as its subject ("Plan · <name>"). The user can add to it ("two days, a slow pace, lunch in Kadıköy") and sends.

## Steps

1. The chat route checks the subject against the user's plans and names it; the user's message carries it as a `<subject>` block ([[ai-chat-flow]]).
2. The assistant reads the plan with `get_plans` (plan_id): every stop with its place's **location** and, for a dated plan, whether the place opens on that day's date (**open_that_day**, from `isOpenOnDate`) — what AI Plan used to weigh. Places to add come from `search_places` (want_to_go, the city). The shared instructions: keep close places on one day, put each on a day it opens, leave stops with an exact time as they are, give each day a short theme in its notes.
3. It proposes the change with `update_plan` (ops naming days by number or id) and writes it out in its reply.
4. **The card shows the plan as it will be** (`describeWrites` for a call still waiting): `previewPlanChanges` runs `preview_plan_changes`, which runs the save itself (`apply_plan_changes`) in a block that always ends in an exception — everything is rolled back — and returns the plan before and after. The card lists the plan's own changes, then every day that changes, stop by stop with its time or part of the day and note, then what is removed; unchanged days don't show (`planChangeLines`). A change that can't be applied says so under the title. The card carries the outcome's **fingerprint** (a hash of the after-plan).
5. The user answers. A yes sends the fingerprint back (`seen`); before running the change, `verifyProposal` previews it again — if the plan would now come out differently (it was edited meanwhile, in another tab or by the app), nothing is saved and the call's result says "The plan changed after this proposal was shown, so nothing was saved. A fresh proposal is needed." — the card shows "Couldn't save" with it, and the model proposes again. Same outcome → the change is saved, in one transaction.
6. After the save the panel refreshes every screen's data, the open plan page included ([[../03-frontend/components/assistant]]).

Without the preview function (the migration not applied), the card falls back to the list of the call's operations and the yes isn't checked: the save itself decides.

## What survives

Stops are moved, not recreated: cost, currency and an exact time survive. Unlike the Gemini version, notes are not replaced wholesale: the assistant changes what it proposes, and the card shows it.

## Cost

A turn on Claude Sonnet 5.5 (the eval's plan-making turn: ≈ $0.09, 16–18 s — [[../04-integrations/claude-agent]]), under the platform's $100 monthly cap. The preview makes no model call. Gemini's AI Plan cost ≈ $0.012 and a few seconds; used 9 times in all (July 8, November 1).

## Until v1.52.0: the Gemini AI Plan

`POST /api/ai/day-plan` (v1.22.0 as `/api/ai/trip-plan`; on the plans model since v1.37.0), from an **AI Plan** dialog: up to 40 candidates (the plan's places, optionally the want-to-go pool for a city) projected compactly with coordinates and per-day open flags, one Gemini call (`DayPlanSchema`, places by index), applied at once as one batch — places left out removed, stop notes replaced, day notes set to "theme — narrative"; no preview, no undo. Budget `trip_plan` (50 a month), SKU `ai_trip_plan` (kept for past rows, `retired`). Removed with its schema, prompt, dialog and `useAiPlan` in v1.53.0.
