---
title: Telegram (notification bot)
type: integration
domain: integrations
version: 1.2.1
last_updated: 26.11.2026
status: draft
sources:
  - src/lib/notify/telegram.ts
  - src/lib/notify/telegram-limits.ts
  - src/lib/notify/telegram-updates.ts
  - src/lib/notify/config.ts
  - src/app/api/telegram/webhook/route.ts
related:
  - "[[_README]]"
  - "[[resend]]"
  - "[[../02-backend/schema/notifications]]"
  - "[[../02-backend/api-routes/notifications]]"
  - "[[../05-flows/notifications-flow]]"
  - "[[../06-ops/env-vars]]"
  - "[[../_plans/phase-3-communication]]"
tags:
  - notifications
  - telegram
---

# Telegram

> A bot that sends the owner's messages to their Telegram chat (Phase 3, v1.57.0): Settings' test and a plan's summary now; reminders and the weekly summary in slice 2. Notifications only — the bot doesn't talk to the assistant (decision 2).

## Account & access

- **Provider:** the [Telegram Bot API](https://core.telegram.org/bots/api), plain HTTPS. Free.
- **Account owner:** Ozan — the bot is made with @BotFather (`/newbot`); its username ends in `bot` and can't change later. Whoever has the token controls the bot; a leaked token is replaced with `/token` in @BotFather.
- **The bot:** **Mappy**, `@mappysitebot` (made by Ozan with @BotFather, 26.11.2026). `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (`mappysitebot`) and `TELEGRAM_WEBHOOK_SECRET` are set in Vercel, Production only (26.11.2026). Linked to Ozan's account in production on 26.11.2026 (after the token value in Vercel was corrected).
- **Production only** (decision 13): a bot has one webhook address, so the bot lives on the production deployment. Preview and local servers have no `TELEGRAM_BOT_TOKEN`: Settings shows "Telegram isn't set up on this server", and a send lists Telegram as `not_connected`. A second, test bot is the way to try it elsewhere.

## NPM packages

None — `fetch` from `src/lib/notify/telegram.ts` (`import "server-only"`).

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | server, Production | `telegram.ts` (`telegramCall`); `telegramConfigured()` |
| `TELEGRAM_BOT_USERNAME` | server, Production | the start link `t.me/<username>?start=…` (with or without the `@`); `telegramConfigured()` |
| `TELEGRAM_WEBHOOK_SECRET` | server, Production | `webhook/route.ts` — compared with the `X-Telegram-Bot-Api-Secret-Token` header. Generate with `openssl rand -hex 32` (Telegram allows `A-Z a-z 0-9 _ -`, up to 256 characters) |

## Where it's used

- **Sending:** `sendTelegram(chatId, html)` → `sendMessage` with `parse_mode: "HTML"` (only `<`, `>`, `&` need escaping; MarkdownV2 has 18 special characters) and link previews off — a plan's message carries several links. A message is at most 4,096 characters (`TELEGRAM_MAX_CHARS`): `render.ts` clips notes (plan 500, day 300, stop 200 characters) and leaves out stops that don't fit, counted ("… ve 12 durak daha — planın tamamı uygulamada"). Only `<b>`, `<i>` and `<a>` are used.
- **Receiving:** a webhook, not `getUpdates` (no long-running process on Vercel). `POST /api/telegram/webhook` checks the secret header in constant time and hands the update to `handleUpdate` (`telegram-updates.ts`): `/start <token>` in a private chat links it (`linkTelegram`), a `my_chat_member` update with status `kicked` / `member` switches the channel off / on, other messages get one line saying the bot only sends notifications. Groups are ignored. The replies are Turkish (`REPLIES`).
- **Linking:** Settings → Connect Telegram asks `POST /api/notifications/telegram` for `https://t.me/<bot>?start=<token>` — a 43-character one-time token (the start payload allows 64 characters of `A-Z a-z 0-9 _ -`), valid 15 minutes. The user presses Start; Telegram sends `/start <token>`; the chat is saved and the bot says "Bağlandı ✓". The same chat with the same link again still answers "linked" (Start tapped twice, an update delivered twice).

### Registering the webhook

**The app does it** (Ozan's choice, 26.11.2026 — so the token and the secret live only in BotFather and Vercel, never on a laptop): every "Connect Telegram" (`POST /api/notifications/telegram` → `telegramStartLink`) first runs `registerWebhook(origin)`:

0. The three settings, trimmed, must have their shape (`telegramSettingsProblem`): the token BotFather's `<number>:<about 35 characters>`, a username, a secret of `A–Z a–z 0–9 _ -` — else the problem is named.
1. Only when `VERCEL_ENV` is `production` (decision 13) — anywhere else it is skipped, and a Start still reaches production's webhook (one database).
2. `getMe`: the token's bot must be the one `TELEGRAM_BOT_USERNAME` names (case aside) — a mistyped username would send the start link to another bot; refused with both names otherwise.
3. `setWebhook` with this deployment's `https://<origin>/api/telegram/webhook`, `secret_token` = `TELEGRAM_WEBHOOK_SECRET` and `allowed_updates` `["message", "my_chat_member"]`. Idempotent: a new address or a rotated secret is picked up on the next Connect. Logged as `telegram.webhook_registered` (address and bot, never the secret).

A refusal comes back to Settings as "Telegram couldn't be set up: …" (Telegram's own words). For diagnosis, `getWebhookInfo` on the Bot API shows the registered address and the last delivery error. The token sits in the URL Telegram requires, so the code never logs a request — a failure reports only Telegram's `description`.

## Cost & limits

- **Unit:** one message sent. **Free allowance:** unlimited; the Bot API is free. **Measured usage:** none yet.
- A bot can't write to someone first: the person must press Start (linking does this).
- Rate limits: 429 with `retry_after` (seconds) — treated as retryable.

## Failure modes

| What | Outcome |
|---|---|
| 403 (blocked by the user, account deleted) | `TelegramChatGone` → the record is `failed`, the channel gets `disabled_at` (shown "Blocked in Telegram"); nothing more is sent there until it is unblocked or linked again. |
| 429, 5xx, timeout (15 s), network | `NotifyError` (retryable); the record is `failed`. |
| Other 4xx | `NotifyError` with Telegram's description, not retryable. |
| A malformed token — no colon, the username or the secret in its place, a space around it | Telegram answers a bare 404 "Not Found" (a well-formed but wrong token: 401 "Unauthorized"; measured 26.11.2026). The first production Connect got exactly this. Since v1.57.9 the settings are trimmed and `telegramSettingsProblem` (`config.ts`) checks their shape before Telegram is called, naming the variable and what looks wrong — never the value. |
| Webhook: wrong or missing secret | `401`; nothing done. |
| Webhook: an update fails inside | Logged as `telegram.update_failed`, answered `200` so Telegram doesn't resend it forever. |

Telegram has no idempotency key: a sender that dies after Telegram accepted a message but before the record says so can, once its 60-second hold lapses, send it again (slice 2's scheduler) — a rare second copy rather than a lost message.

## Replacement strategy

`telegram.ts` and `telegram-updates.ts` are the only Telegram-aware code; the outbox and the channels table don't change if another chat channel is added — it becomes a new `kind`.
