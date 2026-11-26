---
title: Notification routes
type: route-group
domain: backend
version: 1.1.0
last_updated: 26.11.2026
status: draft
sources:
  - src/app/api/notifications/route.ts
  - src/app/api/notifications/email/route.ts
  - src/app/api/notifications/telegram/route.ts
  - src/app/api/notifications/test/route.ts
  - src/app/api/plans/[id]/send/route.ts
  - src/app/api/telegram/webhook/route.ts
  - src/app/(auth)/confirm-email/page.tsx
  - src/app/(auth)/confirm-email/actions.ts
  - src/app/(auth)/confirm-email/confirm-form.tsx
  - src/lib/notify/access.ts
related:
  - "[[_README]]"
  - "[[plans]]"
  - "[[../schema/notifications]]"
  - "[[../../05-flows/notifications-flow]]"
  - "[[../../03-frontend/hooks/use-notifications]]"
  - "[[../../04-integrations/resend]]"
  - "[[../../04-integrations/telegram]]"
  - "[[../../03-frontend/proxy]]"
tags:
  - notifications
---

# Notification routes

Phase 3, slice 1 (v1.57.0): the owner's channels — an e-mail address and a Telegram chat — and sending a plan to them. Thin handlers over `src/lib/notify/`; database errors come back through `errorResponse`.

**Owners only.** In v1 the app sends only to its owner (Phase 3, decision 7): every route below that needs a session asks `notifyContext()` (`src/lib/notify/access.ts`) — signed in, and an account in `ASSISTANT_OWNER_EMAILS`, the same list the assistant is open to. Anyone else gets `403 { error, code: "not_owner" }`, except the settings read, which answers `{ open: false }` so the screen can say so. An account that isn't an owner can't make the app send anything, not even a confirmation link.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/notifications` | — | `NotificationSettingsView`: `{ open: false }`, or `{ open: true, email: { configured, address, confirmed }, telegram: { configured, linked, username, blocked } }`. `configured`: the server has the provider's keys |
| PUT | `/api/notifications/email` | `{ email }` (trimmed, lower-cased, ≤ 254) | `{ status: "sent" }` — the address is saved unconfirmed and its confirmation link sent; `{ status: "already_confirmed" }` for the same confirmed address. `400` not an address · `502` the e-mail couldn't be sent (the provider's reason) · `503` e-mail not set up on this server |
| DELETE | `/api/notifications/email` | — | `{ ok: true }` |
| POST | `/api/notifications/telegram` | — | `{ url }` — `https://t.me/<bot>?start=<token>`, a one-time link for 15 minutes. In production the bot is first pointed at this deployment's webhook (`registerWebhook`: `getMe` must match `TELEGRAM_BOT_USERNAME`, then `setWebhook`). `502` "Telegram couldn't be set up: …" when Telegram refuses · `503` without a bot |
| DELETE | `/api/notifications/telegram` | — | `{ ok: true }` — the chat is unlinked |
| POST | `/api/notifications/test` | `{ channel: "email" \| "telegram" }` | `ChannelResult`. `409` the channel isn't connected · `502` the send failed |
| POST | `/api/plans/[id]/send` | `{ channels?: ("email" \| "telegram")[] }` — left out: every connected channel | `{ plan: { id, name, url }, results: ChannelResult[] }` — each channel answers for itself (`sent`, `busy`, `failed`, `not_connected`). `404` no such plan (a malformed id too) |

`ChannelResult`: `{ channel, status, to?, error? }` — `to` is the address or `@username`.

## Without a session

Both are public in the proxy ([[../../03-frontend/proxy]]); each proves itself.

- **`POST /api/telegram/webhook`** — Telegram posts the bot's updates here; the app registers it itself on Connect in production (`setWebhook` with `secret_token`, `allowed_updates: ["message", "my_chat_member"]`, [[../../04-integrations/telegram#Registering the webhook]]). The `X-Telegram-Bot-Api-Secret-Token` header is compared with `TELEGRAM_WEBHOOK_SECRET` in constant time: `401` when it doesn't match, `404` when the server has no bot or no secret. Otherwise always `200` — a failure is logged (`telegram.update_failed`), else Telegram would keep posting the same update. What the bot does: `handleUpdate` (`src/lib/notify/telegram-updates.ts`) — `/start <token>` links the chat, a block or unblock switches the channel off or on, anything else gets a line saying the bot only sends notifications. Groups are ignored.
- **`/confirm-email?token=…`** — the page the confirmation e-mail links to, in the `(auth)` layout, `noindex`. Opening it changes nothing — mail scanners follow links, and an address must be confirmed by someone who read the message — it shows the address and a **Confirm address** button, or why the link no longer works (expired, replaced by a newer one, the address changed), or that the address is confirmed already. The button posts the token to the server action `confirmEmailAction`, which confirms the address the token was made for and lands on `/settings?tab=notifications&email=confirmed` (or `link-invalid`); Settings says how it went. Pressing it twice still says confirmed.

## Notes

- Messages are rendered from the data at send time, in Turkish (decision 14): `src/lib/notify/render.ts`. Links in them use the request's public origin (`appOrigin`).
- Each send is a `notifications` row first ([[../schema/notifications]]); a "Send to me" or a test is a new row every time (a fresh request id in its key), so pressing it again sends again.
- A channel connected in the database but without the provider's keys on this server (a preview deployment has no Telegram bot, decision 13) is `not_connected`.
