---
title: Assistant components
type: component
domain: frontend
version: 2.5.2
last_updated: 25.11.2026
status: draft
sources:
  - src/components/assistant/assistant-panel.tsx
  - src/components/assistant/assistant-parts.tsx
  - src/components/assistant/assistant-markdown.tsx
  - src/components/assistant/assistant-launcher.tsx
  - src/lib/stores/assistant-store.ts
  - src/lib/hooks/use-assistant-availability.ts
  - src/components/assistant/ask-assistant.tsx
  - src/components/filters/assistant-picks-chip.tsx
related:
  - "[[../../05-flows/ai-chat-flow]]"
  - "[[../../02-backend/api-routes/assistant]]"
  - "[[layout]]"
---

# Assistant components

The in-app assistant's UI (v1.48.0, 24.11.2026 — rebuilt for the Claude agent; the v1.21.0 panel drove the Gemini chat). Flow: [[../../05-flows/ai-chat-flow]]. Approved design (mockups A–D): [[../../_plans/phase-2-assistant]].

## `AssistantLauncher` (`assistant-launcher.tsx`)

The header's ✦ button (`app-header.tsx`). Shown when `useAssistantAvailability()` says so — React Query `["ai-settings"]` → `GET /api/user/ai-settings`, `enabled && assistantAvailable` (the Claude key and, since v1.56.0, an owner account — `assistantOpenTo`); Settings refreshes it when the AI switch changes, so the button follows without a reload (v1.52.0). Opens the panel through `useAssistantStore` and renders `AssistantPanel` once.

## `useAssistantStore` (`src/lib/stores/assistant-store.ts`)

Zustand: `open`, the composer (`text`, `subject`), `sendWhenReady`; `openAssistant(request?)`, `setOpen`, `setText`, `setSubject`, `clearComposer`, `takeSendWhenReady`. Since v1.52.0 the composer lives here rather than in the panel, so what is written survives **New chat** and closing the panel; a reload drops it (the screen's button is one click away; a sent message lives on the server).

A screen opens the panel with a request (`AssistantRequest`: `{ text, subject?, send? }`, decision 6.1): the text goes into the composer with its subject as a chip, the cursor at the end — the user can add to it and send. `send` (the user's own typed words, the search field): it goes out as soon as the conversation shows, unless a reply is being written or cards wait for an answer — then it waits in the composer like a written one.

## `AssistantPanel` (`assistant-panel.tsx`)

- Right `Sheet` on desktop (`sm:max-w-md`), full width on mobile; the body mounts only while open.
- **Conversation:** React Query `["assistant", "conversation"]` → `GET /api/assistant/conversation` (creates one the first time). No refetch on window focus; every 3 s while the server reports a turn in progress.
- **Chat:** one AI SDK `Chat` per conversation id in a module-level map (kept across open / close). `DefaultChatTransport` to `/api/assistant/chat`; `prepareSendMessagesRequest` sends `{ conversationId, input }` only — the user's text with the browser's time zone (and, for a request from a screen, its subject, read from the message's `data-subject` part — v1.52.0), the answers from the last step's cards (`sendMessage(undefined, { body: { intent: "approval" } })`, with `seen` — the fingerprints of the approved cards that showed their outcome, v1.53.0), or Try again (`intent: "retry"`). Nothing is sent on its own: answering a card sends once every card of the paused call has an answer (`approvalsAnswered` — the reads waiting with it don't block it, as the AI SDK's own helper would); before an answer or a retry, the old outcome note is taken off the message (the turn writes a new one at its end). `onFinish`: records the reply's `version`; after a saved change, invalidates every query but the conversation and the lookups that call paid services (`place-search`, `plan-route`) — so a screen's own key refreshes too (until v1.52.0 a fixed list — `places`, `lists`, `plans`, `visits`, `tags` — missed `["plan", id]` and `["place-tags", id]`: an open plan page kept the old plan for up to a minute); always refetches the conversation.
- **Refused before the turn** (`chatFetch`): an HTTP error from the route becomes a `DoorError` with the server's message and code (a redirect to sign-in: "You've been signed out…"). The message wasn't written: it comes off the list and back into the composer, the error shows above it, the conversation is reloaded (a turn running elsewhere, cards that changed). Any other failure (the connection) shows "Couldn't reach the assistant…" and the reload shows whether the turn is running.
- **Sync:** the server's messages replace the local ones whenever the chat isn't streaming and new data has arrived (`dataUpdatedAt`) — unless the copy's `version` is older than what this tab has streamed (a module-level map per conversation).
- **New chat:** `POST /api/assistant/conversation`, written into the query cache; the view remounts on the new id.
- **Writing while a card waits:** the card's part is marked `output-denied` locally, then the message is sent (the server answers the call "not run"). A note above the composer says so.
- **Composer:** textarea (Enter sends, Shift+Enter breaks a line, IME-safe, 8,000 characters as the server allows), 44 px send button, safe-area padding; above it the subject chip of a request from a screen (✕ takes it off, so the message goes without it). A message the panel couldn't send comes back into the composer with its chip. While a reply is being written here or elsewhere (`locked`), sending, the cards' buttons and Try again wait.
- **Empty state:** three Turkish example requests that send on tap.
- **Accessibility:** the message list is `role="log"` `aria-live="polite"` and `aria-busy` while a reply streams; errors `role="alert"`; every button 44 px high.
- **The user's bubble** shows the message's subject chip above it — from the message as sent, then from the server's copy (the names the server read).
- `resetAssistantChat(queryClient?)` — sign-out (`app-header.tsx`) clears the chats, the composer and the assistant queries.

## Parts (`assistant-parts.tsx`)

- `ToolRow` — a read tool or web search: spinner → check with a summary ("12 places"; `rank_places`: "Read place profiles · 30 candidates"); "after your answer" when it waits for a card; **Show N on map** for a search's results (`/map?ids=…`); top web results as links; **Skipped** when it wasn't run (or the turn stopped before it), **didn't work** when it failed. Labels per tool in `READ_TOOLS` (presentation only).
- `ChangeCard` — a write (a plan change waiting for its answer shows the plan as it will be: each changed day with its stops, then what it removes — v1.53.0): the card with its preview (`toolMetadata.preview`: title, subtitle, lines with a label column, "+ N more"), **Save / Not now** (destructive styling for deleting a visit or cancelling a plan); then *Saving…* (or "Will save — answer the other card" while another card waits), **Saved** with "Open …" link, **Not saved**, or **Couldn't save** with the reason (also "Interrupted before it finished" for a run whose turn is gone). `isWritePart` reads the server's mark (`toolMetadata.write`) — no list of write tools on the client. The "Open …" link into the app closes the panel.
- `MapButton` — the one "Show on map" button: on a search row, and under a reply that links saved places — **Show these N on map** for the places the reply links to (`placeIdsIn`: `/places/<id>` links and same-origin URLs, in order, at most 25; v1.49.0). Shown once the reply is written.
- `SubjectChip` — what a request is about (v1.52.0): an icon by kind (plan, places, map) and the label (`subjectLabel`: "Plan · Lizbon hafta sonu", "3 places · …", "Map · Cafe, London"); in the composer with a ✕ whose hit area is 44 px.
- `TurnNote` — the turn's outcome when it isn't a plain answer: a turn running elsewhere, an error with **Try again** when the server says it can help (`retry`), a refusal, a cut-off reply.

## `AskAssistantButton` (`ask-assistant.tsx`, v1.52.0)

A screen's door to the assistant (decision 6.1): an outline ✦ button that calls `openAssistant(request())` — `request` runs on click, so it reads the screen as it is then. Renders nothing when the assistant can't be used; a screen that wraps it in more (a row with a title) checks `useAssistantAvailability` itself. Used by the compare page's `CompareWithAssistant` ([[places]]) and the plan page's `PlanWithAssistant` ([[plans]]).

**`useAskFromSearch(page)`** (v1.54.0) — the search field's door: returns `undefined` when the assistant can't be used, else a function that sends the typed words at once (`send: true`) with the screen as the subject — `{ kind: "view", page, filters, area? }`: the filters on, by id, and on the map the area in view (`useMapAreaStore`). The chip is named from the screen's caches (`getQueriesData` of categories, sub-categories, tags, lists) until the server names it. Passed to `DebouncedSearchInput`'s `onAsk` by the filter panel, the mobile sheet and the `/places` header ([[filters]], [[../../05-flows/ai-search-flow]]).

## `AssistantMarkdown` (`assistant-markdown.tsx`)

`react-markdown` 10.1.0 + `remark-gfm` 4.0.1. Raw HTML is never rendered (`skipHtml`). Links into the app open in place (`next/link`) and close the panel, so the page isn't hidden behind it — decided by resolving the link against the app's origin, as the browser would (`/\host` and `//host` are other sites); others open in a new tab (`noopener noreferrer`). **Images are never loaded**: a reply can carry text from a web page, and an image's URL would send whatever it holds to that server the moment the reply shows — an image renders as a link. Headings render as bold paragraphs; tables scroll horizontally. A numbered list keeps the number it starts from (`start` on `<ol>`): a list the model starts at "3. gün" shows 3, not 1 (v1.54.1, found in the end-to-end run).

## `AssistantPicksChip` (`src/components/filters/assistant-picks-chip.tsx`)

On `/map` and `/places` while the `ids` filter is set ("Show on map"): "N from the assistant ✕" — one tap returns to all places, other filters kept.
