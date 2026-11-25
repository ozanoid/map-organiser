---
title: useNotificationSettings
type: hook
domain: frontend
version: 1.0.0
last_updated: 25.11.2026
status: draft
sources:
  - src/lib/hooks/use-notifications.ts
  - src/lib/notify/types.ts
related:
  - "[[_README]]"
  - "[[../components/settings]]"
  - "[[../components/plans]]"
  - "[[../../02-backend/api-routes/notifications]]"
  - "[[../../05-flows/notifications-flow]]"
---

# `useNotificationSettings` and family

Phase 3, slice 1 (v1.57.0). Types from `src/lib/notify/types.ts` (no server imports — shared with the browser).

| Hook | Does |
|---|---|
| `useNotificationSettings({ waitForTelegram? })` | `["notifications"]` → `GET /api/notifications` (`NotificationSettingsView`: `{ open: false }` for an account that isn't the owner's). With `waitForTelegram`, asks again every 3 s until the Telegram chat is linked and not blocked — the panel waits for the user's Start in Telegram |
| `useSetEmail()` | `PUT /api/notifications/email` → `{ status: "sent" \| "already_confirmed" }` |
| `useRemoveEmail()` | `DELETE /api/notifications/email` |
| `useTelegramLink()` | `POST /api/notifications/telegram` → `{ url }` (the bot's one-time start link) |
| `useUnlinkTelegram()` | `DELETE /api/notifications/telegram` |
| `useSendTest()` | `POST /api/notifications/test` → `ChannelResult` |
| `useSendPlan(planId)` | `POST /api/plans/[id]/send` → `{ plan, results }` |

Every write invalidates `["notifications"]` — a failed test or send may have found the bot blocked, and the screen should say so. Errors come back as `Error(body.error)`, the server's own words.

Consumers: `NotificationSettings` (Settings → Notifications) and `SendPlanDialog` (the plan menu's "Send to me…") — [[../components/settings]], [[../components/plans]].
