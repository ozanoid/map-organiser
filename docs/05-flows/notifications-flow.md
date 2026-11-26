---
title: Notifications flow (channels, "Send to me", reminders and the weekly summary)
type: flow
domain: sharing
version: 1.5.2
last_updated: 26.11.2026
status: draft
sources:
  - src/lib/notify/send.ts
  - src/lib/notify/outbox.ts
  - src/lib/notify/channels.ts
  - src/lib/notify/render.ts
  - src/lib/notify/schedule.ts
  - src/lib/notify/scheduler.ts
  - src/lib/notify/scheduler-store.ts
  - src/app/api/cron/notify/route.ts
  - src/components/settings/notification-settings.tsx
  - src/components/settings/notification-schedule.tsx
  - src/components/layout/time-zone-sync.tsx
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

> The owner connects an e-mail address and a Telegram chat in Settings → Notifications, then sends a plan's summary to them — from the plan's menu ("Send to me…") or by asking the assistant (`send_plan`). Phase 3, slice 1 (v1.57.0). Slice 2 (v1.58.0): a reminder the evening before and the morning of each plan, and a weekly summary, sent by a cron at the times chosen in the same tab. Invitations (slice 3) and calendar files (slice 4) build on the same channels and record.

## Trigger

The owner (an account in `ASSISTANT_OWNER_EMAILS`) in Settings → Notifications, the plan menu, or the assistant. Since slice 2 also the clock: `/api/cron/notify` every 15 minutes sends what is due ([[#Scheduled sends]]).

## Steps

**Connecting e-mail**

1. Settings → Notifications → address → **Save** → `PUT /api/notifications/email`.
2. The server saves it unconfirmed, makes a one-time token (24 hours; only its hash stored) and sends a Turkish e-mail with a button to `/confirm-email?token=…` — itself a `notifications` row (`email_verify`).
3. The page shows the address and **Confirm address**; opening it changes nothing (a mail scanner following the link can't confirm it).
4. Confirm → the server action marks the address confirmed → `/settings?tab=notifications&email=confirmed` → "E-mail address confirmed". Nothing but the confirmation goes to an address before this.
5. Changing the address starts again; the old link confirms nothing afterwards.

**Connecting Telegram** (production only)

1. **Connect Telegram** → `POST /api/notifications/telegram` — in production the server first points the bot at its webhook (`getMe` must match `TELEGRAM_BOT_USERNAME`, then `setWebhook`) → `t.me/<bot>?start=<token>` (15 minutes) → **Open Telegram**; the panel says "Waiting for Start…" and asks the server every 3 s.
2. Start in Telegram → Telegram posts `/start <token>` to `/api/telegram/webhook` → the chat is saved to the token's user → the bot answers "Bağlandı ✓".
3. The next poll sees it: "Telegram connected", **Send test**, **Disconnect**.
4. Blocking the bot switches the channel off (Telegram's `my_chat_member`, or a 403 on the next send): "Blocked in Telegram" and **Connect again**.

**Sending a plan**

1. Plan menu → **Send to me…** → a dialog with the connected channels ticked (or a pointer to Settings when none) → **Send** → `POST /api/plans/[id]/send`. Or the assistant: "send it to my Telegram" → `send_plan` → an approval card naming the plan and where it goes → Approve.
2. `sendPlanToOwner` reads the plan (`getPlan`, the user's session) and renders it once in Turkish (`planSummaryMessage`): dates, days, stops with times or parts of the day, notes, Google Maps links, the plan's link.
3. `sendToOwner` → per channel `deliver`: write the record (`plan_summary:<plan>:<uuid>:<channel>`), claim it (`notification_claim`, 60 s), send, record `sent` with the provider's id and a copy of what went out — or `failed` with the reason.
4. The dialog toasts "Sent to E-mail and Telegram" or each failure; the assistant reports the same.

**Choosing when** (slice 2)

1. Settings → Notifications, under the channels: **Reminders** — *The evening before* (18:00) and *The morning of* (08:00), each a switch and a time in quarter hours, and *Send to* E-mail / Telegram; **Weekly summary** — a switch, *Every* weekday *at* time, *Send to*; **Time zone**. Until the owner changes one, the defaults hold (no row; decisions 8 and 19). A channel not connected stays as chosen, greyed out, "(not connected)"; with no channel connected the section says to connect one first.
2. Each change is saved at once (`PUT /api/notifications/schedule`, every setting together): shown at once, put back with a toast if the server refuses.
3. Time zone: on the first visit from a device, `TimeZoneSync` (in the app layout) sends the browser's zone (`PUT /api/user/time-zone`, `auto`) — stored only while the profile has none — and Settings reads it again. Settings shows the zone with its offset ("Europe/London · GMT"), a searchable list of every zone, and "This device is set to X. **Use it**" when the device differs.

## Scheduled sends

Slice 2 (v1.58.0). Reminders and summaries are **derived** from the plans and the settings at every run, never queued ahead: a plan moved to another date gets its reminders there, a cancelled or deleted one gets none. Each message has one `dedupe_key`, so it is written once whatever the number of runs.

**When** — `src/lib/notify/schedule.ts`, pure (no database, no clock of its own):

- *Reminders:* for each `planned` plan starting between yesterday and two days on (every zone, with the grace period), the evening one the day before its start at the evening time, the morning one on its start day at the morning time — **in the plan's zone** (decision 18): the zone of its first stop, in day and visiting order, at a place with one (`places.google_data.tz`); else the user's (`profiles.time_zone`); else UTC. A Tokyo plan's evening reminder goes at 18:00 Tokyo. Key: `reminder:<plan>:<start date>:<evening|morning>:<channel>`.
- *Weekly summary:* in the user's zone (else UTC), on the chosen weekday at the chosen time, covering **the seven days from that day** — that week on a Monday ("Bu hafta"), the days ahead on another day ("Önümüzdeki 7 gün"). One a week: `weekly:<user>:<ISO week>:<channel>`. Last week's is looked at only while it can still go — a summary due at 23:45 on a Sunday is still sent just after midnight.
- Only to the channels chosen and connected (confirmed, not switched off).
- *Each message's fate now*, given its outbox row: sent, skipped, or failed three times — done; its time not reached — wait; the plan made or changed after its time and nothing on record — skipped `changed` (decision 15: the owner is looking at it; `apply_plan_changes` stamps `plans.updated_at` on every change); more than 3 hours past its time with nothing on record — skipped `late` (the scheduler missed it; a reminder hours late is noise); otherwise send — a failed one again, up to three attempts in all, within those 3 hours.

**A run** — `runScheduler` (`src/lib/notify/scheduler.ts`), data through `supabaseSchedulerStore` (service role):

1. Owners with a usable channel, their settings (`notification_settings`, or the defaults) and zone.
2. Their planned plans starting in the window, each with its zone and when it was last made or changed.
3. Every message they may owe now → their outbox rows by key → the fates above.
4. The skipped ones recorded (`status = 'skipped'`, `skip_reason`).
5. Each one to send: a reminder reads its plan in full (gone or no longer planned meanwhile → nothing) and renders `reminderMessage` — "Yarın: <plan>" / "Bugün: <plan>", the first day's stops only (decision 17), the day count in the subject when the plan is longer; a summary reads the plans with a day in its seven days — none → recorded `empty`, nothing sent (decision 16) — and renders `weeklyMessage` (each plan's dates, days, stops and link). Then `deliver` with its time as `due_at` — the same outbox as "Send to me": record, claim, send, result. A blocked bot switches the chat off.
6. The counts are returned and logged (`notify.run`).

A message goes at the first run at or after its time — within 15 minutes; the times in Settings are quarter hours for that reason.

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
| Connect Telegram | Telegram refuses the webhook, or the token belongs to another bot than `TELEGRAM_BOT_USERNAME` | `502` → toast "Telegram couldn't be set up: …" |
| Connect Telegram | A Telegram setting malformed or missing (the token not BotFather's shape — Telegram itself would say only "Not Found" — or no webhook secret) | `502` → "Telegram couldn't be set up: TELEGRAM_BOT_TOKEN isn't a BotFather token — …; it has no colon" (the variable and what looks wrong, never the value) |
| Telegram start link | Expired or used from another chat | The bot: "Bu bağlantı linki geçersiz…"; the same chat again: "Bağlandı" |
| Telegram start link | The chat belongs to another account | The bot: "Bu Telegram hesabı başka bir Map Organiser hesabına bağlı." |
| Send | Provider error | That channel `failed` with the reason; the other channel is unaffected |
| Send | Bot blocked (403) | `failed`, channel switched off |
| Send | Sender died mid-send | The row stays `sending` until its hold lapses; the next claim takes it over |
| Scheduled send | The cron didn't run at the time (Vercel, an outage) | Sent by the next run within 3 hours; later, recorded `skipped` / `late` |
| Scheduled send | The plan was made, moved or edited after the reminder's time | That reminder recorded `skipped` / `changed`; the next one still goes |
| Scheduled send | A week with no plan | Nothing sent; recorded `skipped` / `empty` |
| Scheduled send | Provider error | `failed`; tried again by the next runs, three attempts in all, within 3 hours |
| Scheduled send | The run itself fails (database) | `500`, `notify.run_failed` in the logs; the next run, 15 minutes later, picks up what is still due |
| Scheduled send | No time zone stored yet | UTC — until the owner opens the app once (`TimeZoneSync`) or picks one in Settings |

## Checks

- `npm run check:notify` — offline: the Turkish messages and their escaping, Telegram's 4,096 characters, the bot's updates, tokens, the outbox, connecting both channels, sending, `send_plan`'s answer and card; since slice 2 also zones and clock changes, ISO weeks, every fate of a scheduled message, the candidates and what is due, the reminder and weekly messages, a whole scheduler run with stand-ins, and the settings store (189 checks on 26.11.2026; 195 with the crons' bearer, v1.58.1 — in-memory tables, stand-in providers and a stand-in for the Bot API).
- `npm run check:notify:db` — the same queries against the live schema, writing nothing (15 of 15 on 25.11.2026, after the migration was applied; 23 of 23 on 26.11.2026 with the scheduler's queries).
- **Dry run of the scheduler on the live data (26.11.2026, 02:04 UTC, nothing written or sent — skip and deliver were stand-ins):** 2 owners with a usable channel (one e-mail, one Telegram), no planned plan in the window. The first run in production will record this week's missed Monday summary as `late` (one record per owner) and send nothing; on Monday 30.11 at 08:05 UTC both summaries come out `empty` — no plan in the seven days. One of the two owners has no time zone stored yet (UTC until the app is opened).
- **End to end, scheduled e-mail (26.11.2026, 02:24 UTC, with Ozan's OK):** a local script ran the scheduler itself — `runScheduler` with the real store and the real outbox — limited to the test account, whose e-mail is Ozan's Gmail. A 4-day test plan from 27.11 (five London stops) was made through `createPlan`. With the clock set to 26.11 18:05 UTC: "Yarın: Mappy hatırlatma denemesi (4 gün)" went — due 18:00 London, the first day's three stops with "11:00", "Öğleden sonra", "19:30" and map links — and this week's missed Monday summary was recorded `late`. With 30.11 08:05: "Bu hafta: 1 plan · 30 Kasım Pazartesi – 6 Aralık Pazar" went, the plan listed as "27 Kasım Cuma – 30 Kasım Pazartesi · 4 gün · 5 durak". Both records `sent` on the first attempt with Resend's id, no error; a run at the same times again would send nothing (dry run). The test plan was deleted afterwards; the three records stay, their plan link cleared (`ON DELETE SET NULL`). Links point at `localhost:3001` (a local run). Ozan: both e-mails arrived. Not tried yet: a scheduled Telegram message (production only).
- **The crons' bearer (26.11.2026, local dev server with a throwaway `CRON_SECRET`):** `/api/cron/notify`, `/api/cron/refresh-places` and `/api/cron/drain-imports` each answer 401 with no header, a wrong bearer and a malformed one (v1.58.1; never called with the right one, which would run their jobs).
- **Settings in Chrome (26.11.2026, local dev server, the test account):** every switch, time, weekday, channel and zone saved and read back; the switches' touch area 44 px; at 375 px no horizontal scroll, *at* and its time wrap together. The test account's settings were put back to the defaults.
- **End to end, e-mail (25.11.2026, local dev server on the branch, the test account `admin@maporganiser.com` in Chrome, Resend with `hello@mappy.site`, to Ozan's own Gmail with his OK):** Settings → Notifications → address saved → "Confirmation link sent" and a `sent` record (the token masked in its copy) → the confirmation page showed the address and **Confirm address**; pressed → back on Settings, "E-mail address confirmed", *Confirmed* → **Send test** → "Test e-mail sent" → the plan *Summer in Amsterdam* (4 days, 19 stops) → **Send to me…** (e-mail ticked, Telegram "Not connected") → "Sent to E-mail". Three records, each `sent` on its first attempt with Resend's id, no error; the requests took 0.4–1.6 s; no console or server errors. The confirmation link was made for the test with `createLinkToken` (the key is sending-only, so the sent e-mail can't be read back); the used link opened again shows "Address confirmed". The plan e-mail, rendered again from the same plan, looked right (Turkish dates and parts of the day, notes, map links, **Planı aç**). In a local run the e-mail's links point at `localhost:3001`. Ozan: all three e-mails arrived in his Gmail.
- **Telegram in production (26.11.2026, Ozan's account):** the first Connect was refused — "Telegram: Not Found", Telegram's answer to a token that isn't BotFather's shape; Ozan corrected `TELEGRAM_BOT_TOKEN` in Vercel, then Connect, Start in Mappy and **Send test** worked: the chat linked at 01:00 UTC, one start link made and used, one Telegram record `sent`. v1.57.9 (trimmed settings, the malformed one named) went to main after (76d9204).
