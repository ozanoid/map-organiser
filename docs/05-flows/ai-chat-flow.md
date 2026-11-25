---
title: Assistant flow (in-app, Claude)
type: flow
domain: ai
version: 2.3.3
last_updated: 25.11.2026
status: draft
sources:
  - src/components/assistant/assistant-panel.tsx
  - src/components/assistant/assistant-parts.tsx
  - src/components/assistant/assistant-launcher.tsx
  - src/lib/stores/assistant-store.ts
  - src/app/api/assistant/chat/route.ts
  - src/app/api/assistant/conversation/route.ts
  - src/lib/agent/run-turn.ts
  - src/lib/agent/ui-stream.ts
  - src/lib/agent/ui.ts
related:
  - "[[../04-integrations/claude-agent]]"
  - "[[../02-backend/api-routes/assistant]]"
  - "[[../03-frontend/components/assistant]]"
  - "[[../_plans/phase-2-assistant]]"
  - "[[claude-connector-flow]]"
---

# Assistant flow (in-app, Claude)

The app's assistant since v1.48.0 (24.11.2026): Claude, run by our server through the agent core, with the same tools claude.ai uses over MCP (17 since `send_plan`, v1.57.0), plus web search. It replaced the Gemini chat of v1.21.0 (`/api/ai/chat`, 8 tools of its own, history in the browser) — Phase 2 of [[../_plans/personal-assistant]], design in [[../_plans/phase-2-assistant]].

## In short

```
Header ✦ (or another screen, with a request written)
   → panel opens → GET /api/assistant/conversation   (latest; the first time POST creates one)
   → user writes → POST /api/assistant/chat {conversationId, input: message}
        server: checks (lease, budget) — refused? HTTP error, the text comes back
                → append the message → model ⇄ tools … → stream
        panel: tool rows as they run, text as it streams, cards when it pauses
   → every card answered: Save / Not now → POST … {input: approval}
        server: the answers fit the cards waiting? → record → run → carry on the same message
   → broke off (Claude busy, …): Try again → POST … {input: retry} → carry on
   → turn ends → panel takes the server's copy (unless older than what it streamed);
     saved changes refresh the views
```

## Opening

- `AssistantLauncher` shows the ✦ button when `GET /api/user/ai-settings` says AI is on for the user and `assistantAvailable` (the server's Claude key and — since v1.56.0 — an owner account, `ASSISTANT_OWNER_EMAILS`).
- `useAssistantStore.openAssistant(request?)` opens the panel from anywhere. A screen's request goes into the composer with its **subject** as a chip — the user adds to it and sends; typed by the user (the search field), it goes out at once when the conversation is free (v1.52.0). In use (Phase 2, decision 6.1): the compare page (v1.52.0), the plan page (v1.53.0, [[ai-plan-flow]]) and the search field (v1.54.0, [[ai-search-flow]]).
- The panel loads the latest conversation; when there is none, it starts one. One `Chat` (AI SDK) per conversation is kept for the app's lifetime, so closing the panel mid-stream keeps the stream.

## A turn

1. The panel sends only the new message and the conversation id (`prepareSendMessagesRequest`); the history lives on the server.
2. The route checks the user and the gates, then runs `runTurn`: the turn lease (one turn per conversation), the monthly budget, the user message with its `<context>` line (date and time in the user's zone, yesterday, the next six days) and, for a request from a screen, its `<subject>` block — the plan, the places or the map's view, checked against the user's library and named on the server before the turn opens (`resolveSubject`, v1.52.0; gone since → 400 `subject_unavailable`), then model calls and tool rounds — at most 10.
3. The panel sees each step: a row per tool ("Searching your places…" → "Searched your places · 12 places"), the reply streaming in Markdown, web searches with their query and top results. Search rows offer **Show on map** (`/map?ids=…`: the panel closes, the map brings those places into view and shows an "N from the assistant" chip that clears it). The reply links the saved places it recommends to their pages (`/places/<id>`), and under it **Show these N on map** puts exactly those on the map (v1.49.0). For a subjective question `rank_places` hands the model the candidates with their profiles ("Read place profiles · 30 candidates") and the model ranks them. Any link into the app closes the panel too.
4. A call that saves something stops the turn. The panel shows a **card** with the proposal in words (the plan's stops and times, the list's places and notes, the visit, the changes) — built on the server from the call's input (`describeWrites`), because the model doesn't describe plans or lists before calling. **Save** / **Not now**: once every card of the paused call has an answer (`approvalsAnswered`), the panel sends them — once, explicitly. The server checks they are the answers to the cards waiting now (an older tab can't decide a card the user hasn't seen), records them, runs approved writes and the reads that waited, and the model goes on in the same message. The card turns into **Saving…**, then **Saved** (with a link to what was saved), **Not saved** or **Couldn't save**. With two cards, the first answered says it will (or won't) be saved and waits for the other.
5. Writing a new message while a card waits closes the card as not saved (in the panel, and on the server as "not run") and sends the message; reads that waited with it show as skipped.
6. A turn that broke off says why at the end of the reply (Claude busy, failing or unreachable, the month's budget, the Console limit, a refusal, a cut-off reply). Where it helps, **Try again** carries the turn on from where it stopped — the user's message isn't sent twice, a call that already ran isn't run again.

## Reliability

- **History append-only, on the server** — the panel takes the server's copy whenever it isn't streaming (after each request, on reopening, when a turn elsewhere ends), unless it is older than what the panel has streamed (`version`: a fetch that started before a turn ended). Reload, another tab and another device show the same conversation.
- **A turn runs to the end on the server** (`after()`), browser or not. On load, a running turn (`turnInProgress`) shows "A reply is still being written…", sending, cards and Try again wait, and the panel checks every 3 s.
- **A refusal before the turn writes nothing**: a turn already running, the budget used up, answers for cards that changed — the server answers with a plain HTTP error, the panel puts the user's text back in the composer and reloads the conversation.
- **One turn at a time**: a second request is refused without spending anything.
- **A write never runs twice**: decisions are recorded before anything runs (`assistant_tool_runs`); a second answer to the same card stops at the database. A card answered before a reload shows "Saving…" while its turn runs; a run whose turn is gone (a crash) shows as interrupted, and Try again tells the model to check.
- **The outcome survives a reload**: how the last turn ended is recorded on the conversation, so its note (and Try again) comes back after a reload.
- **"New chat" sticks**: the panel shows the conversation opened last, not the one written to last.
- **Sign-out** clears the panel's conversations and cache (`resetAssistantChat`).

## Not in the first version (Ozan, 24.11.2026)

No Stop button (a turn is bounded and finishes on the server); only the latest conversation and "New chat" — a list of past conversations and deleting one come later.
