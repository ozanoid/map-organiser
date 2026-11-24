---
title: "Claude agent (platform side)"
type: integration
domain: integrations
version: 1.4.0
last_updated: 24.11.2026
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
  - supabase/migrations/20261123143607_assistant_turns_and_tool_runs.sql
  - scripts/agent-check/db.ts
  - src/lib/agent/door.ts
  - src/lib/agent/ui-stream.ts
  - src/lib/agent/ui.ts
  - src/lib/agent/ui-types.ts
  - src/lib/agent/describe-writes.ts
related:
  - "[[claude-mcp]]"
  - "[[../_plans/phase-2-assistant]]"
  - "[[../02-backend/schema/assistant-conversations]]"
---

# Claude agent (platform side)

The platform's own assistant: Claude, called by our server through the Claude API, using the same tools claude.ai reaches over MCP ([[claude-mcp]]). One core (`src/lib/agent/`) for every door; the first door is the in-app panel ([[../_plans/phase-2-assistant]] — not wired yet). Added 23.11.2026.

**State (24.11.2026):** on `feat/personal-assistant`, not on main. The core ran against the live Claude API and the live database through the eval (below): 209 model calls, $5.03. Its first door — the app's assistant panel — is built (v1.48.0): [[../02-backend/api-routes/assistant]], [[../05-flows/ai-chat-flow]], [[../03-frontend/components/assistant]]; an independent review's findings are fixed, and the third migration (which conversation the door shows, how the last turn ended) is applied (24.11.2026, with Ozan's approval); not yet tried end to end in a signed-in browser.

## How a turn runs

Two steps in `run-turn.ts`: `openTurn(deps, conversationId, input)` checks, `run(events)` does the turn. (`runTurn` does both, for the eval and the offline checks.) The input is the user's **message**, their **approval** — the answers to the cards waiting — or **retry** (Try again).

`openTurn` writes nothing; a refusal there holds nothing and leaves the user's text theirs to send again (the app door answers it as a plain HTTP error):

1. Takes the conversation's **turn lease** — one turn at a time per conversation; another request gets `turn_in_progress` at once, before anything is paid for. The lease runs out after 15 minutes (a route runs at most 800 s), so a crashed turn frees it. Every refusal below gives it back.
2. Loads the conversation (model, system prompt, tools — fixed when it started) and its messages.
3. Checks the input against the conversation as it is now. An approval must answer exactly the cards waiting (`cardsWaiting`: valid writes no request has decided — a decision leaves a run record): none waiting → `nothing_pending`; answers for other calls, or not for all of them → `conflict` (a tab showing an older card must not decide one the user hasn't seen). A retry needs something to carry on (`canRetry`): the conversation ends with a user message — the turn broke off before the model answered — or with the model's calls and no card among them — it broke off before their results were stored; otherwise `conflict`.
4. Checks the month's spend against the cap ($100, `assistant_spend`, platform-wide). Over it, the turn doesn't start.

`run`:

1. Opens with a user message. A new message: a `<context>` block with the user's local date and time, yesterday's date and the next six days' dates (worked out by the model, that arithmetic leaked into its replies), then the text — and any calls still waiting for a card are answered "not run" first. An answer to the card: the waiting calls' results. A retry appends no user message: it runs the reads the model had asked for (a call with a record keeps its recorded result) or goes straight to the model.
2. Calls the model (streamed), records the call in the ledger, stores the reply, and:
   - `tool_use` with only reads → runs them (in parallel), stores the results, calls again;
   - a valid call to a tool that saves something → stops with `awaiting_approval`; the next turn is the user's answer. A call whose input fails its schema gets its error at once and never a card; if no valid write is left, the turn goes on;
   - `pause_turn` (a long web search) → sends it back, the API carries on;
   - `max_tokens` → stores what came, answers a cut-off call "not run", stops;
   - `refusal` → stores nothing for it, stops;
   - `end_turn` → stores the reply, done.
3. After 10 tool rounds (`MAX_STEPS`) the calls are answered "not run — answer with what you have", and the model gets one last call to do so (`step_limit`). (`tool_choice: none` would be simpler but returned an empty reply on both models, 23.11.2026.)
4. Records how the turn ended on the conversation — the status, an error's code, and the history's length then (`recordTurn`, `last_turn_*`) — and gives the lease back. A reload uses it to say why a message has no reply; once anything is appended after it, it no longer describes the end.

Events (`text` with the content block's index, `step`, `toolResult`, `stepRetried`) let a door stream the reply and show tool cards. A handler that throws is logged and ignored — a display problem must not stop, or re-bill, a turn.

## Tool runs: never twice, never lost

Every tool call gets a row in `assistant_tool_runs` (`settleCalls` in `run-turn.ts`) — its decision (`auto` for a read, `approved` / `declined` on the card, `not_run`, `invalid`) **before it runs**, its result after:

- two requests answering the same card: the second can't record the calls again (primary key) and stops;
- a write ran but its result didn't reach the conversation (a crash, a failed write): the next turn reads the recorded result instead of running the tool again — even when the user wrote a new message instead of answering;
- a run recorded as started but never finished was interrupted: the model is told the outcome is unknown and to check before trying again.

The lease keeps turns apart; the runs make a retry safe. Both, and the rule that only the server writes these tables, came with the second migration (`20261123143607_assistant_turns_and_tool_runs`, applied with Ozan's approval on 23.11.2026). The app's store (`supabaseConversationStore`) writes with the service role, bound to the signed-in user; the eval and the offline checks use the in-memory store, which keeps the same rules.

## Why the history never changes

Claude's 5.5 models always think, and each thinking block is bound to the exact conversation before it: system prompt, tools and every earlier message. Sent back changed, the reasoning after the change is dropped or the request refused. So:

- a conversation's model, system prompt and tools are stored when it starts and sent unchanged for its life — a later code change reaches new conversations only;
- messages are stored as the exact JSON the API sent or received, appended, never edited (`assistant_messages`, [[../02-backend/schema/assistant-conversations]]);
- what changes between turns — the date and time — goes into the user message, not the system prompt.

After a refusal fallback mid-answer, the API's rule for sending the turn back is applied once, when it is stored (`echoable` in `history.ts`): before the last `fallback` block only text, the fallback blocks and server-tool calls with their results are kept.

## The request

| Field | Value | Why |
|---|---|---|
| `model` | the conversation's — new ones start on `claude-sonnet-5-5` (effort high), Ozan's choice after the eval (23.11.2026) | fixed per conversation |
| `output_config.effort` | per model (`models.ts`) | fixed per model: a change invalidates every open conversation's cache |
| `thinking` | not sent | always on for the 5.5 models; `display` defaults to omitted |
| `max_tokens` | 16,000 | thinking + text + tool input of one call |
| `system` | one text block with `cache_control` | an explicit cache breakpoint at the end of the fixed prefix (tools + system) |
| `cache_control` (top level) | ephemeral (5 min) | automatic caching of the growing conversation |
| `tools` | the 16 shared tools as JSON Schema (`eager_input_streaming`) + `web_search_20260209` (`max_uses` 10 — a safety ceiling, Ozan 24.11.2026; it was 3) | inputs are validated with the tools' zod schemas before they run |
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

- Most of a turn's time is the tools: `rank_places` (Gemini) 15–40 s, web search 15–27 s; a model call 1–15 s. Text usually comes after all tools (9–21 s on average). Since v1.49.0 `rank_places` doesn't call a model (below).
- Writes: for one change the model says what it saves in a sentence; for a plan or a list it goes to the card without text — the door's approval card has to show the proposal readably.
- Web search: `max_uses` is per request, and with `web_search_20260209` the searches the model's filtering code makes counted 4 in one call with a limit of 3. Ozan first kept 3 (23.11.2026); the signed-in test (24.11.2026) showed it too tight — the filtering code spent all three in its first step, couldn't use the results and had no search left, and the reply said it couldn't search. Now 10 per request (Ozan, 24.11.2026): a ceiling against a runaway loop, not a budget — the model decides how often to search; spend is bounded by the monthly cap and the turn's 10 calls. Conversations started before keep 3 (their tools are fixed). Price: $0.01 a search, plus the tokens of what the model reads (the filtering code is free with web search) — on Sonnet a searching call cost $0.106 in the eval ($0.03 of it 3 searches) and $0.049 in the test ($0.03 searches).
- Caching works as designed: after the first call of a conversation, each call read the ~27k-token prefix from the cache (26,917 tokens written once for $0.067 on Sonnet, then read for $0.0027 a call — a twentieth of the normal input price).

### `rank_places` handed to Claude (v1.49.0, 24.11.2026)

The tool returns the candidates with short profiles and Claude ranks them (decision 6). The six subjective cases of the eval on Sonnet 5.5 high, against the 23.11 run with the Gemini judge (same cases, same library):

| Case | Picks before (Gemini judge) | Picks after (Claude) | Turn time | Cost (Claude) |
|---|---|---|---|---|
| trendy-solo (London, solo, trendy) | Lucia's, Carmel, Bambi, Impala | Barrafina, Impala, Bistro Freddie, Carmel — chosen for counter seating | 36.1 → 25.6 s | $0.126 → $0.199 |
| kadikoy-brunch | Joie, Neni | Joie, Neni | 13.6 → 9.8 s | $0.015 → $0.029 |
| friday-plan (Soho dinner + bar) | Lina Stores + El Siete | Impala + El Siete | 18.2 → 16.0 s | $0.088 → $0.090 |
| laptop-cafe | Thingy, Clarnico, Cinnamon Village 2, E5 Bakehouse | Thingy, Saint Espresso (Here East), Clarnico | 25.7 → 10.3 s | $0.029 → $0.072 |
| lisbon-dinner | 7 restaurants | the same 7 + 4 | 12.7 → 13.8 s | $0.051 → $0.066 |
| romantic-list | Luce e Limoni, Bistro Freddie, Salut!, CIRO'S, Perilla | the same five | 41.5 → 26.0 s | $0.064 → $0.125 |

- Turns 30% faster on average (22.3 → 15.5 s); the call itself 0.4 s.
- The pool costs more than estimated: 16–22k tokens read per ranking (estimated 9–12k; JSON tokenizes at ~2 characters a token, not 4). Claude's cost for the six cases $0.394 → $0.607; the Gemini calls it replaces cost $0.02 each (4 in the old run), so ~$0.02–0.035 more per ranking question.
- `lisbon-dinner` answered from the profiles without `read_reviews` — the dishes are in the pros and themes; the case's expectation was loosened accordingly.

## The app door (v1.48.0)

The panel ([[../03-frontend/components/assistant]]) speaks the AI SDK's UI message format; the server converts both ways ([[../02-backend/api-routes/assistant]]):

- **Live:** `turnStream` (`ui-stream.ts`) turns the agent's events into stream chunks — a step per model call, a text part per content block as it streams, a part per tool call and its result, the turn's outcome as `data-turn` (with the conversation's length, and whether Try again can help). A write call is held until the turn pauses, then sent with its **preview** and an approval request; every write is marked as one (`toolMetadata.write`).
- **Stored:** `toUIMessages` (`ui.ts`) turns the append-only history (and the tool runs, and the recorded last turn) into the same UI messages, so a reload shows what the live stream showed: a card already answered shows "Saving…" while its turn runs, a run the turn never finished shows as interrupted, the last turn's outcome note comes back.
- **One message id scheme** (`replyMessageId`): an assistant message's id is its first model message's position (`a{seq}`). The live stream's reply uses the same id, so a turn that carries a message on — an answer to its cards, Try again — updates it in place.
- **Place links** (v1.49.0): the app's prompt (`prompt.ts`) has the model link a saved place to its page in the app (`[name](/places/<id>)`) instead of its maps_url; the panel offers "Show these N on map" for the places a reply links (`placeIdsIn`, `ui-types.ts`). claude.ai keeps maps_url links (the shared instructions).
- **Previews** (`describe-writes.ts`): the card's text from the call's input — ids resolved to names through the user's own rows; a place proposed from a Google Maps search named from that search's result in the conversation. The model doesn't describe plans or lists before calling (eval), so the card has to.
- **After the browser:** the chat route waits for the turn with `after()`; the turn lease makes another tab wait instead of starting a second turn.

## Errors

`AgentError` (`errors.ts`) with a code per cause and a message for the user (`userMessageFor`, also for a recorded code): the platform cap (`budget_exhausted`), the Console's organisation limit (`spend_limit` — a 429 with `enforced_spend_limit_reached`), billing, busy (rate limit / overload after the SDK's two retries), auth, a rejected request, an API failure, connection, a conflict (the input no longer fits the conversation: another request appended first or answered the same calls, the answers aren't for the cards waiting now, nothing to try again), a turn already in progress, nothing pending, not found. `isTransient` — busy, an API failure, connection — marks the ones Try again can fix.

## Testing

- `npm run check:agent` (`scripts/agent-check/run.ts`) — free, offline: the loop with a scripted stand-in for the Claude API, the in-memory store and a stand-in tool runner; since v1.48.0 also the panel's view of a stored conversation (`toUIMessages`) and a live turn as the panel receives it (`turnStream`). 120 checks: every stop reason, approve / decline / a new message instead, one turn at a time, a result surviving a failed append, an interrupted run, Try again (after a busy API, a failed append, an interrupted run), the checks before a turn (answers that don't fit the cards, nothing to retry, the lease given back), the recorded outcome, invalid writes, the step limit, a broken stream (aborted, re-run, partial spend), API error codes, the budget, a throwing handler, the fallback echo rule, costs; the panel's view (ids, saving / interrupted cards, skipped reads, outcome notes after a reload, reply ids) and the live stream (text blocks, write marks, versions, Try again).
- `npm run check:agent:db` (`scripts/agent-check/db.ts`) — free, against the live database **without writing**: every store and ledger query on a conversation that doesn't exist — reads come back empty, updates touch no row, inserts are refused only by the foreign key — plus `latest` read-only on the user's own rows. Proves the queries (tables, columns, the lease's filter) are ones the database accepts.
- `npm run eval:assistant` — paid, against the live API and Ozan's library ([[../../scripts/assistant-eval/README]]).
- Checked against the live API on 23.11.2026 (a few tiny requests, < $0.01): consecutive messages of one role — `user, user` and `assistant, assistant`, also a `tool_result` message followed by a new user message — are accepted and read as one turn, so a turn that ends without a reply (refusal, error) doesn't break the next one. (The skill's bundled error table says 400; the live API doesn't.)

## Telemetry

Each model call: a JSON log line `agent.step` (model, stop reason, tokens, cost, ms) and a Langfuse generation; each tool: `assistant.tool` (`door: agent`) and a Langfuse tool span; the turn is one Langfuse trace (`assistant`, session = conversation id).
