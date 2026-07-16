---
title: Assistant components
type: component
domain: frontend
version: 1.0.0
last_updated: 16.07.2026
status: stable
sources:
  - src/components/assistant/assistant-panel.tsx
  - src/components/assistant/assistant-launcher.tsx
related:
  - "[[../../05-flows/ai-chat-flow]]"
  - "[[../../02-backend/api-routes/ai]]"
  - "[[layout]]"
---

# Assistant components

v1.21.0 (S3 AI-02). Two components under `src/components/assistant/`.

## `AssistantLauncher`

Header entry point (mounted in `AppHeader` next to Add Place). Fetches
`GET /api/user/ai-settings` once and renders nothing unless
`enabled && available` — the same lazy gate AiSearchInput uses. Renders
the ✨ button + owns the panel's open state.

## `AssistantPanel`

The chat surface: `Sheet side="right"` — `data-[side=right]:sm:max-w-md`
overrides the base component's `sm:max-w-sm` cap (same modifier chain so
twMerge replaces rather than duels); full-width on mobile.

- **State:** `useChat({ chat })` from `@ai-sdk/react` with a
  module-scope `Chat` instance (`DefaultChatTransport` →
  `/api/ai/chat`, sessionId in body). Panel close/reopen keeps the
  conversation; "New chat" resets instance + sessionId. No zustand
  store — the Chat instance IS the session state.
- **Message rendering:** user bubbles right-aligned emerald; assistant
  parts iterate `message.parts`:
  - `text` → whitespace-pre-wrap with a `**bold**`-only mini renderer
    (the system prompt restricts the model to bold-only markdown).
  - tool parts (`isToolUIPart`) switch on `part.state`:
    `input-streaming/available` → spinner + label;
    `approval-requested` → emerald confirm card with Approve/Cancel
    (`addToolApprovalResponse`); `output-available` → per-tool result
    (search hits render as compact linked rows, mutations as ✓ lines);
    `output-denied` → "Action cancelled."; `output-error` → red line.
- **Auto-resubmit:** `sendAutomaticallyWhen:
  lastAssistantMessageIsCompleteWithApprovalResponses`.
- **Cache sync:** an effect watches mutation tool outputs (by
  toolCallId, deduped in a ref) and invalidates `["lists"]`,
  `["places"]`, `["stats"]`.
- **Composer:** auto-growing `Textarea` (field-sizing-content), Enter
  submits / Shift+Enter newline, Stop button while streaming; empty
  state shows three suggestion chips that send directly.

## Gotchas

- `@ai-sdk/react` is version-locked to the `ai` package — see the
  lockstep warning in [[../../04-integrations/gemini#npm-packages]].
- Errors from the transport (429 budget, 403 disabled) surface via
  `useChat().error` → `friendlyError()` maps them to readable text.
