---
title: "Claude agent (platform side)"
type: integration
domain: integrations
version: 1.0.0
last_updated: 23.11.2026
status: draft
sources:
  - src/lib/agent/run-turn.ts
  - src/lib/agent/history.ts
  - src/lib/agent/store.ts
  - src/lib/agent/spend.ts
  - src/lib/agent/pricing.ts
  - src/lib/agent/models.ts
  - src/lib/agent/tools.ts
  - src/lib/agent/prompt.ts
  - src/lib/agent/errors.ts
  - src/lib/agent/client.ts
  - src/lib/assistant/instructions.ts
  - src/lib/assistant/run-tool.ts
  - scripts/assistant-eval/run.ts
  - scripts/assistant-eval/cases.ts
related:
  - "[[claude-mcp]]"
  - "[[../_plans/phase-2-assistant]]"
  - "[[../02-backend/schema/assistant-conversations]]"
---

# Claude agent (platform side)

The platform's own assistant: Claude, called by our server through the Claude API, using the same tools claude.ai reaches over MCP ([[claude-mcp]]). One core (`src/lib/agent/`) for every door; the first door is the in-app panel ([[../_plans/phase-2-assistant]] — not wired yet). Added 23.11.2026.

**State (23.11.2026):** the core is on `feat/personal-assistant`, not on main; no route calls it yet. It ran against the live Claude API and the live database through the eval (below): 209 model calls, $5.03.

## How a turn runs

`runTurn(deps, conversationId, input, events)` in `run-turn.ts`:

1. Loads the conversation (model, system prompt, tools — fixed when it started) and its messages.
2. Checks the month's spend against the cap ($100, `assistant_spend`, platform-wide). Over it, the turn doesn't start.
3. Appends the user message: a `<context>` block with the user's local date and time, yesterday's date and the next six days' dates (worked out by the model, that arithmetic leaked into its replies), then their text. Tool calls still waiting for an approval are answered "not run" first. Or, for an approval answer: runs the waiting calls — approved writes and the reads made with them; a declined write gets "the user declined".
4. Calls the model (streamed), records the call in the ledger, stores the reply, and:
   - `tool_use` with only read tools → runs them (in parallel), stores the results, calls again;
   - a call to a tool that saves something → stops with `awaiting_approval` and the calls; the next turn is the user's answer;
   - `pause_turn` (a long web search) → sends it back, the API carries on;
   - `max_tokens` → stores what came, answers a cut-off call "not run", stops;
   - `refusal` → stores nothing for it, stops;
   - `end_turn` → stores the reply, done.
5. At most 10 model calls per turn (`MAX_STEPS`); past that the calls are answered "not run — tell the user what you have" and the turn stops.

Events (`text`, `step`, `toolResult`, `stepRetried`) let a door stream the reply and show tool cards.

## Why the history never changes

Claude's 5.5 models always think, and each thinking block is bound to the exact conversation before it: system prompt, tools and every earlier message. Sent back changed, the reasoning after the change is dropped or the request refused. So:

- a conversation's model, system prompt and tools are stored when it starts and sent unchanged for its life — a later code change reaches new conversations only;
- messages are stored as the exact JSON the API sent or received, appended, never edited (`assistant_messages`, [[../02-backend/schema/assistant-conversations]]);
- what changes between turns — the date and time — goes into the user message, not the system prompt.

After a refusal fallback mid-answer, the API's rule for sending the turn back is applied once, when it is stored (`echoable` in `history.ts`): before the last `fallback` block only text, the fallback blocks and server-tool calls with their results are kept.

## The request

| Field | Value | Why |
|---|---|---|
| `model` | the conversation's (default `claude-opus-5-5`, provisional until the eval decides) | fixed per conversation |
| `output_config.effort` | per model (`models.ts`) | fixed per model: a change invalidates every open conversation's cache |
| `thinking` | not sent | always on for the 5.5 models; `display` defaults to omitted |
| `max_tokens` | 16,000 | thinking + text + tool input of one call |
| `system` | one text block with `cache_control` | an explicit cache breakpoint at the end of the fixed prefix (tools + system) |
| `cache_control` (top level) | ephemeral (5 min) | automatic caching of the growing conversation |
| `tools` | the 16 shared tools as JSON Schema (`eager_input_streaming`) + `web_search_20260209` (`max_uses` 3) | inputs are validated with the tools' zod schemas before they run |
| `betas`, `fallbacks` | `server-side-fallback-2026-07-01`, `"default"` | a request the safety classifiers decline is re-run on the recommended fallback model inside the same call |

## Approval

A tool whose annotation says it writes (`readOnlyHint: false`) runs only after the user approves it: `add_places`, `create_plan`, `update_plan`, `save_list`, `log_visit`, `delete_visit`, `update_places`. The rule is read from the current code (`needsApproval` in `tools.ts`). Reads made in the same message wait with the write and run after the answer. The system prompt tells the model the card is how the user agrees, so it doesn't also ask in text.

## Spend

Each model call → one `assistant_spend` row: tokens (input, output, cache write, cache read), web searches, dollars at the price of the day (`pricing.ts`, checked 23.11.2026). The cost comes from `usage.iterations` when present — the per-attempt billing record (server-tool rounds; with a fallback, the declined attempt and the fallback's, each at its own model's price) — otherwise from the top-level usage. A model not in the price list is charged at the highest listed price and logged. A stream that breaks off is recorded from what had arrived.

Prices per million tokens (input / 5-min cache write / cache read / output): Opus 5.5 $4 / $5 / $0.20 / $20; Sonnet 5.5 $2 / $2.50 / $0.10 / $10; fallbacks Opus 5 and Opus 4.8 $5 / $6.25 / $0.50 / $25, Sonnet 5 $2 / $2.50 / $0.20 / $10. Web search $10 per 1,000. No free tier.

## Measured

- **The fixed prompt is about 27,000 tokens** (count_tokens, 23.11.2026): system prompt ~1,380, the 16 tools ~19,800 (`update_plan` alone ~5,500, `save_list` ~2,450), web search ~5,900 (the basic `web_search_20250305` is ~2,700; the 20260209 version filters results with code before they reach the context). It is written to the cache on the first call of a conversation — and again after 5 idle minutes — and read on every later call: on Opus 5.5 a write is $0.135, a read $0.005. Every conversation and user shares this cache entry while it lives.

### Eval (23.11.2026)

`npm run eval:assistant` — 12 of Ozan's requests on his library, four model / effort settings; full results and the recommendation in [[../_plans/phase-2-assistant#Eval sonuçları (23.11.2026)]]. In short:

| Setting | Right tools and write proposal | Per case | Avg turn |
|---|---|---|---|
| Opus 5.5 medium | 12/12 | $0.096 | 19.9 s |
| Sonnet 5.5 high | 12/12 | $0.048 | 15.8 s |
| Sonnet 5.5 medium | 11/12 | $0.029 | 13.4 s |
| Opus 5.5 low | 9/12 | $0.058 | 13.5 s |

- Most of a turn's time is the tools: `rank_places` (Gemini) 15–40 s, web search 15–27 s; a model call 1–15 s. Text usually comes after all tools (9–21 s on average).
- Writes: for one change the model says what it saves in a sentence; for a plan or a list it goes to the card without text — the door's approval card has to show the proposal readably.
- Web search: `max_uses: 3` is per request, but with `web_search_20260209` the searches the model's filtering code makes counted 4 in one call.
- Caching works as designed: after the first call of a conversation, each call read the ~27k-token prefix from the cache (26,917 tokens written once for $0.067 on Sonnet, then read for $0.0027 a call — a twentieth of the normal input price).

## Errors

`AgentError` (`errors.ts`) with a code per cause and a message for the user: the platform cap (`budget_exhausted`), the Console's organisation limit (`spend_limit` — a 429 with `enforced_spend_limit_reached`), billing, busy (rate limit / overload after the SDK's two retries), auth, a rejected request, an API failure, connection, a conflict (another request appended first — the `(conversation_id, seq)` key), nothing pending, not found.

## Telemetry

Each model call: a JSON log line `agent.step` (model, stop reason, tokens, cost, ms) and a Langfuse generation; each tool: `assistant.tool` (`door: agent`) and a Langfuse tool span; the turn is one Langfuse trace (`assistant`, session = conversation id).
