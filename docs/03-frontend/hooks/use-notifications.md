---
title: useNotificationSettings
type: hook
domain: frontend
version: 1.1.0
last_updated: 26.11.2026
status: draft
sources:
  - src/lib/hooks/use-notifications.ts
  - src/lib/notify/types.ts
  - src/components/layout/time-zone-sync.tsx
related:
  - "[[_README]]"
  - "[[../components/settings]]"
  - "[[../components/plans]]"
  - "[[../../02-backend/api-routes/notifications]]"
  - "[[../../05-flows/notifications-flow]]"
---

# `useNotificationSettings` and family

Phase 3, slice 1 (v1.57.0); slice 2 (v1.58.0) added the schedule and the time zone. Types from `src/lib/notify/types.ts` and `ScheduleSettings` from `src/lib/notify/schedule.ts` (no server imports — shared with the browser).

| Hook | Does |
|---|---|
| `useNotificationSettings({ waitForTelegram? })` | `["notifications"]` → `GET /api/notifications` (`NotificationSettingsView`: `{ open: false }` for an account that isn't the owner's; open, it carries the channels, `schedule` and `timeZone`). With `waitForTelegram`, asks again every 3 s until the Telegram chat is linked and not blocked — the panel waits for the user's Start in Telegram |
| `useSetEmail()` | `PUT /api/notifications/email` → `{ status: "sent" \| "already_confirmed" }` |
| `useRemoveEmail()` | `DELETE /api/notifications/email` |
| `useTelegramLink()` | `POST /api/notifications/telegram` → `{ url }` (the bot's one-time start link) |
| `useUnlinkTelegram()` | `DELETE /api/notifications/telegram` |
| `useSendTest()` | `POST /api/notifications/test` → `ChannelResult` |
| `useSendPlan(planId)` | `POST /api/plans/[id]/send` → `{ plan, results }` |
| `useSaveSchedule()` | `PUT /api/notifications/schedule` with every setting → `{ schedule }`. Optimistic: writes the new schedule into `["notifications"]` first, puts the old view back on an error |
| `useSetTimeZone()` | `PUT /api/user/time-zone` `{ timeZone, auto? }` → `{ timeZone }` (the zone now stored) |

Every write invalidates `["notifications"]` — a failed test or send may have found the bot blocked, and the screen should say so. Errors come back as `Error(body.error)`, the server's own words.

Consumers: `NotificationSettings` and `NotificationSchedule` (Settings → Notifications) and `SendPlanDialog` (the plan menu's "Send to me…") — [[../components/settings]], [[../components/plans]].

**`TimeZoneSync`** (`src/components/layout/time-zone-sync.tsx`, in the app layout) isn't a hook but feeds the same view: once per device and zone (remembered in `localStorage` under `time-zone-synced`) it sends the browser's zone with `auto` — stored only while the profile has none — and invalidates `["notifications"]`, so an open Settings shows the zone without a refresh. Storage blocked: it sends again next time, harmlessly.
