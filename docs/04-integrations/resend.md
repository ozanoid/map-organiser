---
title: Resend (e-mail)
type: integration
domain: integrations
version: 1.3.0
last_updated: 26.11.2026
status: draft
sources:
  - src/lib/notify/email.ts
  - src/lib/notify/config.ts
  - src/lib/notify/outbox.ts
  - src/lib/notify/render.ts
related:
  - "[[_README]]"
  - "[[telegram]]"
  - "[[../02-backend/schema/notifications]]"
  - "[[../02-backend/api-routes/notifications]]"
  - "[[../05-flows/notifications-flow]]"
  - "[[../06-ops/env-vars]]"
  - "[[../_plans/phase-3-communication]]"
tags:
  - notifications
  - email
---

# Resend

> Sends the app's e-mails (Phase 3, v1.57.0): the address confirmation, Settings' test, and a plan's summary ("Send to me", `send_plan`). In v1 only to the owner's own confirmed address (decision 7).

## Account & access

- **Provider:** [Resend](https://resend.com). Chosen for its idempotency key (24 hours), signed webhooks and Node SDK; Postmark and Amazon SES were weighed in [[../_plans/phase-3-communication]].
- **Account owner:** Ozan — the account, the domain and its DNS records, and the API key are set up by him in the Resend dashboard (steps in the Phase 3 doc).
- **Sending domain:** `mappy.site` — a domain Ozan bought for it (25.11.2026), its DNS on Vercel (`ns1.vercel-dns.com`), instead of the `mail.maporganiser.com` the design proposed. DNS checked on 25.11.2026: the DKIM key `resend._domainkey.mappy.site` and `send.mappy.site` (a CNAME to Resend's own sending service, `send.forge.rmta.net`, which carries the SPF and the bounce MX — the newer style of Resend domain) are in place; DMARC `_dmarc.mappy.site` = `v=DMARC1; p=none;` is in place too (Ozan; seen from Vercel's nameserver, Google and Cloudflare at 23:41 UTC — a check at 23:12 UTC still got no answer). Account data and logs are kept in the US whatever the sending region; the region can't be read with a sending-only key.
- **Sender:** `EMAIL_FROM` = `hello@mappy.site`. A bare address is sent as **Mappy** — `Mappy <hello@mappy.site>` (`fromHeader`, `SENDER_NAME` in `render.ts`; Ozan, 26.11.2026 — the bot's name; the design had "Map Organiser"); a value that names its sender ("Name <address>") is used as it is.
- **Auth:** `RESEND_API_KEY`, server-only — a **sending-only** key (Resend's "Sending access": it can send and nothing else; reading domains or sent e-mails answers 401 `restricted_api_key`). That is all the app needs.
- **Tracking:** open and click tracking stay off (a per-domain setting in Resend; never turned on).

## NPM packages

`resend` (^6.39.0) — `src/lib/notify/email.ts` only (`import "server-only"`), one client per server instance.

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `RESEND_API_KEY` | server (Production, Preview, local `.env.local`) | `email.ts`; `emailConfigured()` (`config.ts`) |
| `EMAIL_FROM` | server (same) | `email.ts`; `emailConfigured()` |

Without both, `emailConfigured()` is false: Settings says "E-mail isn't set up on this server", the e-mail routes answer `503`, and a send lists e-mail as `not_connected`.

## Where it's used

`sendEmail({ to, subject, html, text }, idempotencyKey)` → Resend's message id; the From is `fromHeader(EMAIL_FROM)`. Called only by `deliver` (`outbox.ts`), after the `notifications` row is written and claimed; the key is `notification-<row id>`, so a retry of the same record within 24 hours can't send it twice. Every e-mail carries an HTML part and a plain-text part, both rendered in Turkish by `render.ts` (inline styles, one 560 px column, the app's emerald accent, a footer link to Settings → Notifications). The templates are typed string builders rather than React Email: short messages, deterministic, checked offline (`npm run check:notify`) — the confirmation, the test, a plan's summary, and since v1.58.0 the reminder ("Yarın: <plan>" / "Bugün: <plan>", the first day's stops) and the weekly summary ("Bu hafta: N plan" on a Monday, "Önümüzdeki 7 gün: N plan" on another day); React Email can come when the invitation e-mails of slice 3 need it. A scheduled message's record carries its time as `due_at` (`Delivery.dueAt`).

## Cost & limits

- **Unit:** one e-mail sent.
- **Free allowance:** 3,000 e-mails a month, at most 100 a day; past it Resend answers 429 — it doesn't queue. Pro is $20 a month for 50,000 (Resend's pricing page, read 25.11.2026).
- **Measured usage:** none yet — nothing sent before v1.57.0 is deployed and the key is set.
- **Expected:** a handful a week in slice 1 (confirmations, tests, "Send to me"); slice 2's reminders and weekly summary add about 10 a week (an estimate: two reminders per plan per channel, one summary a week; nothing for a week without plans). Well inside the free allowance. Measured after slice 2 goes live.
- A new domain's first e-mails may land in Gmail's spam: mark them "Not spam".
- **DMARC** — in place: a TXT record named `_dmarc` with `v=DMARC1; p=none;` (Vercel → Domains → `mappy.site` → DNS). It tells receiving servers the domain has a policy, which helps inbox placement; `p=none` changes no delivery.

## Failure modes

| What | Outcome |
|---|---|
| Network error, no answer | `NotifyError` (retryable). The record is `failed`; the screen shows the reason. |
| Resend error (`{ error }`) | `NotifyError` with Resend's message; retryable for `rate_limit_exceeded`, `daily_quota_exceeded`, `application_error`, `internal_server_error`, `concurrent_idempotent_requests`. |
| A retry within 24 hours | The idempotency key makes it a no-op at Resend: no second e-mail. |
| Keys missing | Nothing is attempted (`not_connected` / `503`). |

Slice 1 has no automatic retry — the user presses again (a new record). Slice 2's scheduler retries `failed` records. No webhook yet (bounces, complaints): everything goes to the owner's own confirmed address; it comes with e-mail to anyone else.

## Replacement strategy

Only `email.ts` knows Resend. Another provider means a new `sendEmail` with the same signature and its own duplicate protection (Postmark has none; SES would need the record's status alone).
