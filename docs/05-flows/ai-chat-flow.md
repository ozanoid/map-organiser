---
title: AI Chat Flow
type: flow
domain: ai
version: 1.0.0
last_updated: 16.07.2026
status: stable
sources:
  - src/app/api/ai/chat/route.ts
  - src/lib/ai/chat-tools.ts
  - src/lib/ai/prompts/chat.ts
  - src/components/assistant/assistant-panel.tsx
  - src/components/assistant/assistant-launcher.tsx
related:
  - "[[../02-backend/api-routes/ai]]"
  - "[[../04-integrations/gemini]]"
  - "[[ai-search-flow]]"
  - "[[observability-flow]]"
---

# AI Chat Flow

S3 AI-02 v1 (v1.21.0): the assistant — chat-based discovery and action
over the user's saved places. Agent loop with 7 tools; session-only
memory; approval-gated mutations.

## Trigger

✨ button in the AppHeader (desktop + mobile) — rendered only when
`GET /api/user/ai-settings` reports `enabled && available` (same gate as
AiSearchInput). Opens a right Sheet (max-w-md on desktop, full-width on
mobile).

## Steps

```
1. User opens panel, types a message
       │  • useChat({ chat: sharedChat }) — module-scope Chat instance:
       │    closing/reopening the panel keeps the conversation;
       │    "New chat" swaps in a fresh instance + sessionId
       │
       ▼
2. POST /api/ai/chat { messages: UIMessage[], sessionId }
       │  • Gates BEFORE streaming: auth 401 → after(flushLangfuse) →
       │    ai_features_enabled 403 → getAiClient 503 →
       │    checkAiBudget("chat") 429 → validate 400
       │  • History trimmed to last 30 messages server-side
       │  • isNewTurn = last message role === "user"
       │
       ▼
3. streamText agent loop (stopWhen: stepCountIs(6))
       │  • system = buildChatSystemPrompt(buildUserContext()) —
       │    real taxonomy ids injected; "never invent ids" rule
       │  • tools (cookie client, RLS = ownership boundary):
       │      search_places      → shared queryPlaces() engine
       │      get_place_details  → place + tags + lists + profile
       │      compare_places     → data-only side-by-side (model verbalises)
       │      get_stats          → shared computeUserStats()
       │      add_to_list        ┐
       │      create_list        ├ needsApproval: true
       │      set_visit_status   ┘
       │  • outputs are COMPACT projections — full google_data never
       │    enters the loop (token cost)
       │
       ▼
4. UIMessage stream renders progressively in the panel
       │  • tool states: input-streaming/available → spinner line;
       │    output-available → result card (search hits link to
       │    /places/[id]); output-error → red line
       │
       ▼ (mutation proposed)
5. approval-requested → confirm card (Approve / Cancel)
       │  • addToolApprovalResponse({ id, approved }) +
       │    sendAutomaticallyWhen: lastAssistantMessageIsComplete-
       │    WithApprovalResponses → auto-resubmit
       │  • The continuation POST's last message is the ASSISTANT's →
       │    isNewTurn=false → NO second budget unit
       │  • Approved → tool executes server-side → success line;
       │    denied → output-denied → "Action cancelled."
       │
       ▼
6. onFinish: trackAiUsage("ai_chat") if isNewTurn (1 unit/turn) + log
       │
       ▼
7. Client cache sync: panel watches mutation tool outputs and
   invalidates ["lists"] / ["places"] / ["stats"] — chat-driven
   mutations bypass the TanStack mutation hooks, so open views would
   otherwise go stale.
```

## Budget & cost

- SKU `ai_chat`, cap `AI_MONTHLY_CHAT_CAP = 200` turns/month (code
  constant, not env). One unit per TURN regardless of step count;
  `stopWhen: stepCountIs(6)` bounds in-turn fan-out.
- costPer1k = $15 — fixed average-turn estimate (~2-3 Flash steps);
  `increment_api_usage` freezes cost_per_1k at the first daily insert,
  so per-turn variable cost cannot be recorded.
- CostTracker picks the SKU up automatically via the AI_SKU_CONFIG
  spread.

## Session memory (v1 scope)

Client-side only: the UIMessage array lives in the module-scope Chat
instance and round-trips on every POST. Survives client-side navigation
and panel close; gone on hard refresh/sign-out. Persistent
`chat_memories` / summarization is deliberately v2 (v4 plan, Tema 3).

## Failure modes

- **Budget spent:** 429 before the stream; panel shows "Monthly AI chat
  limit reached".
- **LLM/stream error mid-turn:** onError logs; the client renders the
  error and the user can retry. The turn's unit is only charged in
  onFinish (unlike compare's burn-on-failure — a turn that never
  finishes doesn't count).
- **Hallucinated ids in tool args:** RLS-scoped queries return
  not-found; the model gets an honest `{error}` and recovers. No
  cross-user leak is possible through tools.
- **Stale profile content:** tool outputs surface `place_profile`
  summaries — until the Tema 6 re-profile runs, those derive from the
  v1.15.1-era truncated-review inputs (v4 PART 4 #8).

## Open questions

- Langfuse multi-step stream traces: the umbrella-span filter drops the
  root ai.streamText span; verify no cost double-count on the first
  production traces (chat is the first multi-doStream feature).
- Suggestion chips are static English samples — localize or derive from
  the user's taxonomy later.
