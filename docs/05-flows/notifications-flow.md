---
title: Notifications flow (channels and "Send to me")
type: flow
domain: sharing
version: 1.0.1
last_updated: 25.11.2026
status: draft
sources:
  - src/lib/notify/send.ts
  - src/lib/notify/outbox.ts
  - src/lib/notify/channels.ts
  - src/lib/notify/render.ts
  - src/components/settings/notification-settings.tsx
  - src/components/plans/send-plan-dialog.tsx
  - src/lib/assistant/tools/send-plan.ts
  - scripts/notify-check/run.ts
related:
  - "[[_README]]"
  - "[[../02-backend/api-routes/notifications]]"
  - "[[../02-backend/schema/notifications]]"
  - "[[../04-integrations/resend]]"
  - "[[../04-integrations/telegram]]"
  - "[[../03-frontend/components/settings]]"
  - "[[../03-frontend/components/plans]]"
  - "[[../04-integrations/claude-mcp]]"
  - "[[../_plans/phase-3-communication]]"
tags:
  - notifications
---

# Notifications flow

> The owner connects an e-mail address and a Telegram chat in Settings → Notifications, then sends a plan's summary to them — from the plan's menu ("Send to me…") or by asking the assistant (`send_plan`). Phase 3, slice 1 (v1.57.0). Reminders and the weekly summary (slice 2), invitations (slice 3) and calendar files (slice 4) build on the same channels and record.

## Trigger

The owner (an account in `ASSISTANT_OWNER_EMAILS`) in Settings → Notifications, the plan menu, or the assistant. Nothing is sent unasked in slice 1.

## Steps

**Connecting e-mail**

1. Settings → Notifications → address → **Save** → `PUT /api/notifications/email`.
2. The server saves it unconfirmed, makes a one-time token (24 hours; only its hash stored) and sends a Turkish e-mail with a button to `/confirm-email?token=…` — itself a `notifications` row (`email_verify`).
3. The page shows the address and **Confirm address**; opening it changes nothing (a mail scanner following the link can't confirm it).
4. Confirm → the server action marks the address confirmed → `/settings?tab=notifications&email=confirmed` → "E-mail address confirmed". Nothing but the confirmation goes to an address before this.
5. Changing the address starts again; the old link confirms nothing afterwards.

**Connecting Telegram** (production only)

1. **Connect Telegram** → `POST /api/notifications/telegram` → `t.me/<bot>?start=<token>` (15 minutes) → **Open Telegram**; the panel says "Waiting for Start…" and asks the server every 3 s.
2. Start in Telegram → Telegram posts `/start <token>` to `/api/telegram/webhook` → the chat is saved to the token's user → the bot answers "Bağlandı ✓".
3. The next poll sees it: "Telegram connected", **Send test**, **Disconnect**.
4. Blocking the bot switches the channel off (Telegram's `my_chat_member`, or a 403 on the next send): "Blocked in Telegram" and **Connect again**.

**Sending a plan**

1. Plan menu → **Send to me…** → a dialog with the connected channels ticked (or a pointer to Settings when none) → **Send** → `POST /api/plans/[id]/send`. Or the assistant: "send it to my Telegram" → `send_plan` → an approval card naming the plan and where it goes → Approve.
2. `sendPlanToOwner` reads the plan (`getPlan`, the user's session) and renders it once in Turkish (`planSummaryMessage`): dates, days, stops with times or parts of the day, notes, Google Maps links, the plan's link.
3. `sendToOwner` → per channel `deliver`: write the record (`plan_summary:<plan>:<uuid>:<channel>`), claim it (`notification_claim`, 60 s), send, record `sent` with the provider's id and a copy of what went out — or `failed` with the reason.
4. The dialog toasts "Sent to E-mail and Telegram" or each failure; the assistant reports the same.

## Inputs / outputs

- In: the plan as it is now; the user's channels.
- Out: one `notifications` row per channel per send (`content`: to, subject, text); for Telegram a chat message, for e-mail an HTML + text e-mail.

## Failure modes

| Step | Failure | Surfaced as |
|---|---|---|
| Any route | Not an owner | `403 not_owner`; Settings and the dialog say notifications are only open to the owner |
| Provider keys missing on this server | — | "isn't set up on this server" (Settings), `not_connected` (send) |
| Confirmation e-mail | Resend error | `502` → toast with Resend's reason; the address stays unconfirmed, **Send the link again** |
| Confirm page | Expired, replaced, address changed | "This link doesn't work any more" + a link to Settings |
| Telegram start link | Expired or used from another chat | The bot: "Bu bağlantı linki geçersiz…"; the same chat again: "Bağlandı" |
| Telegram start link | The chat belongs to another account | The bot: "Bu Telegram hesabı başka bir Map Organiser hesabına bağlı." |
| Send | Provider error | That channel `failed` with the reason; the other channel is unaffected |
| Send | Bot blocked (403) | `failed`, channel switched off |
| Send | Sender died mid-send | The row stays `sending` until its hold lapses; slice 2's scheduler takes it over |

## Checks

- `npm run check:notify` — offline: the Turkish messages and their escaping, Telegram's 4,096 characters, the bot's updates, tokens, the outbox, connecting both channels, sending, `send_plan`'s answer and card (107 checks, in-memory tables, stand-in providers).
- `npm run check:notify:db` — the same queries against the live schema, writing nothing (15 of 15 on 25.11.2026, after the migration was applied).
