---
title: Assistant components
type: component
domain: frontend
version: 2.1.0
last_updated: 24.11.2026
status: draft
sources:
  - src/components/assistant/assistant-panel.tsx
  - src/components/assistant/assistant-parts.tsx
  - src/components/assistant/assistant-markdown.tsx
  - src/components/assistant/assistant-launcher.tsx
  - src/lib/stores/assistant-store.ts
  - src/components/filters/assistant-picks-chip.tsx
related:
  - "[[../../05-flows/ai-chat-flow]]"
  - "[[../../02-backend/api-routes/assistant]]"
  - "[[layout]]"
---

# Assistant components

The in-app assistant's UI (v1.48.0, 24.11.2026 — rebuilt for the Claude agent; the v1.21.0 panel drove the Gemini chat). Flow: [[../../05-flows/ai-chat-flow]]. Approved design (mockups A–D): [[../../_plans/phase-2-assistant]].

## `AssistantLauncher` (`assistant-launcher.tsx`)

The header's ✦ button (`app-header.tsx`). Shown when `GET /api/user/ai-settings` returns `enabled && assistantAvailable`. Opens the panel through `useAssistantStore` and renders `AssistantPanel` once.

## `useAssistantStore` (`src/lib/stores/assistant-store.ts`)

Zustand: `open`, `draft`, `openAssistant(draft?)`, `setOpen`, `takeDraft()`. Any screen can open the panel with a request written into the composer; the panel takes the draft on mount and while open (a store subscription).

## `AssistantPanel` (`assistant-panel.tsx`)

- Right `Sheet` on desktop (`sm:max-w-md`), full width on mobile; the body mounts only while open.
- **Conversation:** React Query `["assistant", "conversation"]` → `GET /api/assistant/conversation` (creates one the first time). No refetch on window focus; every 3 s while the server reports a turn in progress.
- **Chat:** one AI SDK `Chat` per conversation id in a module-level map (kept across open / close). `DefaultChatTransport` to `/api/assistant/chat`; `prepareSendMessagesRequest` sends `{ conversationId, input }` only — the user's text with the browser's time zone, the answers from the last step's cards (`sendMessage(undefined, { body: { intent: "approval" } })`), or Try again (`intent: "retry"`). Nothing is sent on its own: answering a card sends once every card of the paused call has an answer (`approvalsAnswered` — the reads waiting with it don't block it, as the AI SDK's own helper would); before an answer or a retry, the old outcome note is taken off the message (the turn writes a new one at its end). `onFinish`: records the reply's `version`; after a saved change, invalidates `places`, `lists`, `plans`, `visits`, `tags`; always refetches the conversation.
- **Refused before the turn** (`chatFetch`): an HTTP error from the route becomes a `DoorError` with the server's message and code (a redirect to sign-in: "You've been signed out…"). The message wasn't written: it comes off the list and back into the composer, the error shows above it, the conversation is reloaded (a turn running elsewhere, cards that changed). Any other failure (the connection) shows "Couldn't reach the assistant…" and the reload shows whether the turn is running.
- **Sync:** the server's messages replace the local ones whenever the chat isn't streaming and new data has arrived (`dataUpdatedAt`) — unless the copy's `version` is older than what this tab has streamed (a module-level map per conversation).
- **New chat:** `POST /api/assistant/conversation`, written into the query cache; the view remounts on the new id.
- **Writing while a card waits:** the card's part is marked `output-denied` locally, then the message is sent (the server answers the call "not run"). A note above the composer says so.
- **Composer:** textarea (Enter sends, Shift+Enter breaks a line, IME-safe, 8,000 characters as the server allows), 44 px send button, safe-area padding. While a reply is being written here or elsewhere (`locked`), sending, the cards' buttons and Try again wait.
- **Empty state:** three Turkish example requests that send on tap.
- **Accessibility:** the message list is `role="log"` `aria-live="polite"` and `aria-busy` while a reply streams; errors `role="alert"`; every button 44 px high.
- `resetAssistantChat(queryClient?)` — sign-out (`app-header.tsx`) clears the chats and the assistant queries.

## Parts (`assistant-parts.tsx`)

- `ToolRow` — a read tool or web search: spinner → check with a summary ("12 places"); "after your answer" when it waits for a card; **Show N on map** for search / rank results (`/map?ids=…`); top web results as links; **Skipped** when it wasn't run (or the turn stopped before it), **didn't work** when it failed. Labels per tool in `READ_TOOLS` (presentation only).
- `ChangeCard` — a write: the card with its preview (`toolMetadata.preview`: title, subtitle, lines with a label column, "+ N more"), **Save / Not now** (destructive styling for deleting a visit or cancelling a plan); then *Saving…* (or "Will save — answer the other card" while another card waits), **Saved** with "Open …" link, **Not saved**, or **Couldn't save** with the reason (also "Interrupted before it finished" for a run whose turn is gone). `isWritePart` reads the server's mark (`toolMetadata.write`) — no list of write tools on the client.
- `TurnNote` — the turn's outcome when it isn't a plain answer: a turn running elsewhere, an error with **Try again** when the server says it can help (`retry`), a refusal, a cut-off reply.

## `AssistantMarkdown` (`assistant-markdown.tsx`)

`react-markdown` 10.1.0 + `remark-gfm` 4.0.1. Raw HTML is never rendered (`skipHtml`). Links into the app open in place (`next/link`) — decided by resolving the link against the app's origin, as the browser would (`/\host` and `//host` are other sites); others open in a new tab (`noopener noreferrer`). **Images are never loaded**: a reply can carry text from a web page, and an image's URL would send whatever it holds to that server the moment the reply shows — an image renders as a link. Headings render as bold paragraphs; tables scroll horizontally.

## `AssistantPicksChip` (`src/components/filters/assistant-picks-chip.tsx`)

On `/map` and `/places` while the `ids` filter is set ("Show on map"): "N from the assistant ✕" — one tap returns to all places, other filters kept.
