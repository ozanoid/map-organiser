---
title: Assistant routes
type: route-group
domain: backend
version: 1.3.0
last_updated: 25.11.2026
status: draft
sources:
  - src/app/api/assistant/chat/route.ts
  - src/app/api/assistant/conversation/route.ts
  - src/lib/agent/door.ts
  - src/lib/agent/ui-stream.ts
  - src/lib/agent/ui.ts
  - src/lib/agent/ui-types.ts
  - src/lib/agent/describe-writes.ts
related:
  - "[[_README]]"
  - "[[../../04-integrations/claude-agent]]"
  - "[[../../05-flows/ai-chat-flow]]"
  - "[[../../03-frontend/components/assistant]]"
  - "[[../schema/assistant-conversations]]"
---

# Assistant routes

The app door of the platform's Claude agent ([[../../04-integrations/claude-agent]]): the assistant panel talks to these two routes. Added in v1.48.0 (24.11.2026), replacing the Gemini chat route `/api/ai/chat`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/assistant/conversation` | The user's latest conversation, as the panel shows it, and whether a turn of it is running now |
| `POST` | `/api/assistant/conversation` | "New chat": a new, empty conversation becomes the latest; the old one stays |
| `POST` | `/api/assistant/chat` | One turn: the user's message or their answers to the approval cards in, the turn streamed out |

## Shared gating (`doorRequest`, `src/lib/agent/door.ts`)

1. Signed in (cookie session) — else **401**.
2. The server has `ANTHROPIC_API_KEY` — else **503** "The assistant isn't set up on this server."
3. `profiles.ai_features_enabled` isn't false — else **403**.

Tools run with the user's own session (RLS). The agent's tables and the spend ledger are written with the service role, every query scoped to the user in code (`supabaseConversationStore(admin, userId)`).

## `GET /api/assistant/conversation`

- **Response** (`ConversationResponse`, `src/lib/agent/ui-types.ts`): `{ conversation: { id, turnInProgress } | null, messages: UIMessage[], version }`.
- `messages` is the stored history converted for the panel (`toUIMessages`, `src/lib/agent/ui.ts`): one user message per message the user wrote (the `<context>` and `<subject>` blocks hidden; a subject shows as a `data-subject` part, its kind and label — v1.52.0), one assistant message per turn (id `a{seq}` of its first model message) with a `step-start` part per model call; every tool call a `dynamic-tool` part whose state comes from the results in the history and the run records (`assistant_tool_runs`) — done, failed, declined or not run (`output-denied` — reads too: skipped, not failed), answered and saving while a turn runs (`approval-responded`), interrupted when the turn that ran it is gone (`output-error`), or, in the last message, waiting: a valid write no request has decided is `approval-requested` with its card preview in `toolMetadata.preview` (`describeWrites`), reads made with it are `input-available`. Writes carry `toolMetadata.write`, and every write in the conversation its preview — the waiting card, and what was saved or not ("Not saved · Create list: …"), as the live reply showed it (one batch of name lookups, `describeWrites`). Tool outputs are trimmed to what the panel shows (`uiToolOutput`: a summary, the places for "Show on map" — a search's results, not `rank_places`' candidates, which are material for the model, shown as "N candidates" — a link to what a write saved).
- **The last turn's outcome** ends the last assistant message as a `data-turn` part when there's something to say — from the conversation's recorded last turn (`last_turn_*`) while nothing has been appended after it: an error with its message (and `retry` when Try again can carry the turn on), a refusal, a cut-off reply. With no record of how the turn ended (a crash, a timeout) and something to carry on: "interrupted", with Try again. After the user's message with no reply stored (a refusal, an error before it), the note is an assistant message of its own, with the id the reply had.
- `version`: the number of stored messages. The panel ignores a copy older than what it has streamed.
- `turnInProgress`: the conversation's turn lease hasn't run out — a turn is running (another tab, a closed panel, a reload mid-turn). The panel polls every 3 s until it ends; no cards are offered and no outcome note is shown meanwhile.
- "Latest" is the conversation the user **opened** last (`opened_at`), not the one written to last — a turn still running in an older conversation doesn't pull the panel back to it.

## `POST /api/assistant/conversation`

Starts a conversation (`startConversation`, door `app`, `DEFAULT_AGENT_MODEL`): its system prompt and tools are fixed now, and it becomes the latest (`opened_at`). Response as GET, with no messages, `version` 0. The panel also calls it when GET finds no conversation yet.

## `POST /api/assistant/chat`

- **Body** (`ChatRequestBody`): `{ conversationId: uuid, input }`, `input` one of
  - `{ kind: "message", text (1–8000), timeZone, subject? }` — the browser's IANA zone, for the turn's `<context>` line; `subject` (v1.52.0, `SubjectSchema` in `src/lib/agent/subject.ts`) when the request comes from a screen: `{ kind: "plan", planId }`, `{ kind: "places", placeIds (1–5) }` or `{ kind: "view", page: "map" | "places", filters (the app's, by id), area? { lat, lng, radiusM } }`. It is checked against the user's library and named before the turn opens (`resolveSubject`: names from the database, never from the request; filters turned into names, an id the user no longer has dropped) and kept in the user's message as a `<subject>` block after `<context>`;
  - `{ kind: "approval", decisions: { [toolUseId]: boolean } }` — one answer for every card waiting now, no other;
  - `{ kind: "retry" }` — Try again: carry on a turn that broke off.
- **Before the turn — a plain HTTP error, nothing written** (`openTurn`; body `DoorErrorBody` `{ error, code }`): **400** malformed body, or `subject_unavailable` (the plan or a place isn't the user's any more — "That plan isn't in your library any more."); **404** `not_found`; **409** `turn_in_progress` (a turn of this conversation is running), `conflict` (the answers aren't for the cards waiting now, or there's nothing to try again — the conversation changed elsewhere), `nothing_pending` (no card waits); **429** `budget_exhausted`; **500** otherwise. The panel gives the user their text back and reloads the conversation.
- **Response:** the AI SDK UI message stream (`createUIMessageStream`), written by `turnStream` (`src/lib/agent/ui-stream.ts`) from the agent's events:
  - `start` with the reply's message id (`replyMessageId`): a new message's reply gets a new id; an answer or a retry carries on the message the panel shows — the same id, so the panel updates it in place instead of adding a copy;
  - `start-step` / `finish-step` around each model call; `text-start` / `text-delta` / `text-end` as the reply streams, a text part per content block;
  - a read call: `tool-input-available` (dynamic) when the model makes it, `tool-output-available` / `tool-output-error` with its result, `tool-output-denied` when it wasn't run (the user wrote instead, a limit); a web search: input and results together, `providerExecuted`;
  - a write call (`toolMetadata.write`) is held back until the turn pauses, then sent with its preview (`toolMetadata.preview`) and a `tool-approval-request` (`approvalId` = the tool-use id);
  - the turn's outcome last: `data-turn` `{ status: done | awaiting_approval | refused | max_tokens | step_limit, version }`, or `{ status: "error", code, message, retry, version }` when it broke off (Claude busy or failing, the Console limit, …) — `version` is the conversation's length then, `retry` whether Try again can help;
  - results for calls of the message being carried on update their parts; a call from an earlier message answered "not run" by a new message isn't sent.
- **The turn doesn't depend on the browser:** `after()` waits for it, so a closed panel or a reload mid-turn doesn't stop it; the result is stored and GET shows it. `maxDuration = 800` (a turn: up to 10 model calls plus tools — ranking 15–40 s, a web search ~30 s); the turn lease (15 min) outlasts it.
- **Telemetry:** the agent's Langfuse trace (`assistant`, session = conversation id) and log lines (`agent.step`, `assistant.tool` with `door: agent`, `assistant.turn` with the input kind, `assistant.turn_refused`, `assistant.turn_failed`); the trace is flushed after the turn (one `after()` that waits for it, then flushes).
