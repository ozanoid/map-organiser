---
title: "Claude agent (platform side)"
type: integration
domain: integrations
version: 1.1.0
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
  - scripts/agent-check/run.ts
  - supabase/migrations/20261123140000_assistant_turns_and_tool_runs.sql
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

1. Takes the conversation's **turn lease** — one turn at a time per conversation; another request gets `turn_in_progress` at once, before anything is paid for. The lease runs out after 15 minutes (a route runs at most 800 s), so a crashed turn frees it.
2. Loads the conversation (model, system prompt, tools — fixed when it started) and its messages; checks the month's spend against the cap ($100, `assistant_spend`, platform-wide). Over it, the turn doesn't start.
3. Opens with a user message. A new message: a `<context>` block with the user's local date and time, yesterday's date and the next six days' dates (worked out by the model, that arithmetic leaked into its replies), then the text — and any calls still waiting for a card are answered "not run" first. An answer to the card: the waiting calls' results.
4. Calls the model (streamed), records the call in the ledger, stores the reply, and:
   - `tool_use` with only reads → runs them (in parallel), stores the results, calls again;
   - a valid call to a tool that saves something → stops with `awaiting_approval`; the next turn is the user's answer. A call whose input fails its schema gets its error at once and never a card; if no valid write is left, the turn goes on;
   - `pause_turn` (a long web search) → sends it back, the API carries on;
   - `max_tokens` → stores what came, answers a cut-off call "not run", stops;
   - `refusal` → stores nothing for it, stops;
   - `end_turn` → stores the reply, done.
5. After 10 tool rounds (`MAX_STEPS`) the calls are answered "not run — answer with what you have", and the model gets one last call to do so (`step_limit`). (`tool_choice: none` would be simpler but returned an empty reply on both models, 23.11.2026.)

Events (`text`, `step`, `toolResult`, `stepRetried`) let a door stream the reply and show tool cards. A handler that throws is logged and ignored — a display problem must not stop, or re-bill, a turn.

## Tool runs: never twice, never lost

Every tool call gets a row in `assistant_tool_runs` (`settleCalls` in `run-turn.ts`) — its decision (`auto` for a read, `approved` / `declined` on the card, `not_run`, `invalid`) **before it runs**, its result after:

- two requests answering the same card: the second can't record the calls again (primary key) and stops;
- a write ran but its result didn't reach the conversation (a crash, a failed write): the next turn reads the recorded result instead of running the tool again — even when the user wrote a new message instead of answering;
- a run recorded as started but never finished was interrupted: the model is told the outcome is unknown and to check before trying again.

The lease keeps turns apart; the runs make a retry safe. Both, and the rule that only the server writes these tables, come with the second migration — prepared and checked in a rolled-back transaction on 23.11.2026, **not applied** (it needs Ozan's approval). Until then the Supabase store can't run; the eval and the offline checks use the in-memory store, which keeps the same rules.

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

A tool whose annotation says it writes (`readOnlyHint: false`) runs only after the user approves it: `add_places`, `create_plan`, `update_plan`, `save_list`, `log_visit`, `delete_visit`, `update_places`. The rule is read from the current code (`needsApproval` in `tools.ts`); the card opens only for a call whose input passes the tool's schema (`checkToolCall`). Reads made in the same message wait with the write and run after the answer. The system prompt tells the model the card only asks yes or no and to say what it is saving first; for a single change it does (one sentence), for a plan or a list it doesn't (eval, 23.11.2026) — the door's card has to show the proposal.

## Spend

Each model call → one `assistant_spend` row: tokens (input, output, cache write, cache read), web searches, dollars at the price of the day (`pricing.ts`, checked 23.11.2026). The cost comes from `usage.iterations` when present — the per-attempt billing record (server-tool rounds; with a fallback, the declined attempt and the fallback's, each at its own model's price) — otherwise from the top-level usage. A model not in the price list is charged at the highest listed price and logged. A stream that breaks off without an API error is aborted (the server would otherwise go on generating, billed) and re-run once; what it used is recorded from what had arrived — input in full, output only as far as the API had reported it, so a broken call is under-counted. A refusal fallback's declined attempt is priced at the requested model.

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

`AgentError` (`errors.ts`) with a code per cause and a message for the user: the platform cap (`budget_exhausted`), the Console's organisation limit (`spend_limit` — a 429 with `enforced_spend_limit_reached`), billing, busy (rate limit / overload after the SDK's two retries), auth, a rejected request, an API failure, connection, a conflict (another request appended first, or answered the same calls), a turn already in progress, nothing pending, not found.

## Testing

- `npm run check:agent` (`scripts/agent-check/run.ts`) — free, offline: the loop with a scripted stand-in for the Claude API, the in-memory store and a stand-in tool runner. 70 checks: every stop reason, approve / decline / a new message instead, one turn at a time, a result surviving a failed append, an interrupted run, invalid writes, the step limit, a broken stream (aborted, re-run, partial spend), API error codes, the budget, a throwing handler, the fallback echo rule, costs.
- `npm run eval:assistant` — paid, against the live API and Ozan's library ([[../../scripts/assistant-eval/README]]).
- Checked against the live API on 23.11.2026 (a few tiny requests, < $0.01): consecutive messages of one role — `user, user` and `assistant, assistant`, also a `tool_result` message followed by a new user message — are accepted and read as one turn, so a turn that ends without a reply (refusal, error) doesn't break the next one. (The skill's bundled error table says 400; the live API doesn't.)

## Telemetry

Each model call: a JSON log line `agent.step` (model, stop reason, tokens, cost, ms) and a Langfuse generation; each tool: `assistant.tool` (`door: agent`) and a Langfuse tool span; the turn is one Langfuse trace (`assistant`, session = conversation id).
