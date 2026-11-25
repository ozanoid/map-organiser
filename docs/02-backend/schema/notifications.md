---
title: notification_channels, channel_link_tokens, notifications
type: table
domain: backend
version: 1.3.0
last_updated: 25.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261125203540_notifications.sql
  - supabase/migrations/20261125224149_notifications_plan_index.sql
  - src/lib/notify/channels.ts
  - src/lib/notify/tokens.ts
  - src/lib/notify/outbox.ts
  - scripts/notify-check/db.ts
related:
  - "[[_README]]"
  - "[[../rls-policies]]"
  - "[[../api-routes/notifications]]"
  - "[[../../05-flows/notifications-flow]]"
  - "[[../../04-integrations/resend]]"
  - "[[../../04-integrations/telegram]]"
  - "[[../../_plans/phase-3-communication]]"
tags:
  - notifications
  - outbox
---

# `notification_channels`, `channel_link_tokens`, `notifications`

Phase 3, slice 1 ([[../../_plans/phase-3-communication]]): where the owner gets messages — one e-mail address and one Telegram chat — the one-time tokens that connect them, and a record of every message the app sends. **Applied on 25.11.2026 with Ozan's approval** — migration `notifications`, version 20261125203540 (v1.57.0; the file was written as 20261125160000 and renamed to the recorded version). A dry-run in a rolled-back transaction passed first (results below); after applying, `npm run check:notify:db` passed 15 of 15 against the live schema, writing nothing. All three tables are new; nothing existing changes.

Every write is the server's, with the service role, scoped to the user in code (`src/lib/notify/`); users only read their own rows. With no write policies, a signed-in user can't mark an address confirmed or point a channel at someone else's chat through the REST API.

## `notification_channels`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `kind` | text | no | — | CHECK `email` \| `telegram`. |
| `email` | text | yes | — | `kind = 'email'` only. CHECK ≤ 254 characters, `like '%_@_%'`. Stored trimmed and lower-cased (`emailAddress`, `channels.ts`). |
| `telegram_chat_id` | bigint | yes | — | `kind = 'telegram'` only. Telegram chat ids run to 52 bits. |
| `telegram_username` | text | yes | — | As Telegram sent it with `/start`; shown in Settings ("@ozan"). |
| `verified_at` | timestamptz | yes | — | E-mail: Confirm pressed on `/confirm-email`. Telegram: linked. Nothing but the confirmation goes to an address before it. |
| `disabled_at` | timestamptz | yes | — | Nothing is sent while set: the bot was blocked (Telegram answered 403, or a `my_chat_member` "kicked" update came). Cleared on unblock or a new link. |
| `created_at`, `updated_at` | timestamptz | no | `now()` | `updated_at` set by the code on each change. |

Constraints: `unique (user_id, kind)` — one address and one chat per user in v1; CHECK that an e-mail row has an address and no chat and a Telegram row a chat and no address. Index `notification_channels_telegram_chat_key` — unique `telegram_chat_id` where `kind = 'telegram'`: one chat belongs to one account (a second account linking it gets "taken").

## `channel_link_tokens`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `token_hash` | text | no | — | **PK**. SHA-256 (hex) of the token. The token itself — 32 random bytes, base64url, 43 characters — lives only in the link. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `purpose` | text | no | — | CHECK `email_verify` \| `telegram_link`. |
| `email` | text | yes | — | `email_verify`: the address it confirms. CHECK: set exactly when the purpose is `email_verify`. |
| `expires_at` | timestamptz | no | — | `email_verify` 24 hours, `telegram_link` 15 minutes. |
| `used_at` | timestamptz | yes | — | Set by the one statement that uses it (`consumeLinkToken`: update … where unused and unexpired). |
| `created_at` | timestamptz | no | `now()` | — |

Index `channel_link_tokens_user_idx (user_id, created_at desc)`. The design named this table `telegram_link_tokens`; the e-mail confirmation needs the same one-time link, so one table serves both, told apart by `purpose`.

## `notifications`

The outbox: every message sent or to be sent is a row, written before it is sent.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. Also Resend's idempotency key (`notification-<id>`). |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `kind` | text | no | — | CHECK `email_verify` \| `channel_test` \| `plan_summary` \| `plan_reminder` \| `weekly_summary` \| `rsvp_received`. Slice 1 writes the first three; the rest are slices 2–3. |
| `channel` | text | no | — | CHECK `email` \| `telegram`. |
| `plan_id` | uuid | yes | — | FK → `plans.id`, ON DELETE SET NULL — what was sent stays on record after the plan is gone. |
| `dedupe_key` | text | no | — | **Unique**: the same message can't be written twice. Slice 1: `plan_summary:<plan>:<request uuid>:<channel>`, `channel_test:<uuid>:<channel>`, `email_verify:<token hash>`. Slice 2: one reminder per plan, day and channel. |
| `due_at` | timestamptz | no | `now()` | When it should go (slice 2's scheduler). |
| `status` | text | no | `pending` | CHECK `pending` \| `sending` \| `sent` \| `failed` \| `skipped`. |
| `attempts` | smallint | no | `0` | CHECK ≥ 0. Counted by each claim. |
| `claimed_until` | timestamptz | yes | — | The sender's hold. CHECK: set exactly while `status = 'sending'`. |
| `last_error` | text | yes | — | The provider's answer, ≤ 500 characters. |
| `provider_message_id` | text | yes | — | Resend's message id, or Telegram's `message_id`. |
| `content` | jsonb | yes | — | What went out: `{ to, subject, text }` — the plan may change later; what was sent can't be rebuilt. A message's secrets are masked in it (`Delivery.secrets`): the confirmation e-mail's copy reads `…/confirm-email?token=•••` — the token lives only in the e-mail (v1.57.3; before, the copy kept the whole link). |
| `created_at` | timestamptz | no | `now()` | — |
| `sent_at` | timestamptz | yes | — | — |

Indexes: `notifications_due_idx (due_at) where status in ('pending', 'sending', 'failed')` — slice 2's "what is due"; `notifications_user_idx (user_id, created_at desc)`. `notifications_plan_idx (plan_id)` — added by a follow-up migration, `notifications_plan_index` (version 20261125224149, applied 25.11.2026 with Ozan's approval): `plan_id` is a foreign key with ON DELETE SET NULL, and without an index deleting a plan read the whole table to find its records. Supabase's performance advisor flagged it right after the first apply (lint 0001); after the index it no longer does.

### `notification_claim(p_id uuid, p_lease_seconds integer default 120) returns setof notifications`

One sender at a time: a `pending` or `failed` row — or one still `sending` whose hold has lapsed (its sender died between claiming and recording) — becomes `sending`, its attempt counted, held for `p_lease_seconds`. Returns the row, or nothing when another sender holds it or it was sent or skipped. A lapsed hold is taken over rather than given up: a lost reminder is worse than a rare second copy, and e-mail can't come twice anyway (Resend's idempotency key, 24 hours). `language sql`, SECURITY INVOKER, empty `search_path`; `EXECUTE` revoked from `public`, `anon`, `authenticated`, granted to `service_role`. `deliver` (`outbox.ts`) holds a row for 60 s.

## RLS policies

| Table | Policy | Operation | Role | Predicate |
|---|---|---|---|---|
| `notification_channels` | Users read own notification channels | SELECT | authenticated | `(select auth.uid()) = user_id` |
| `notifications` | Users read own notifications | SELECT | authenticated | `(select auth.uid()) = user_id` |
| `channel_link_tokens` | — (RLS on, no policy) | — | — | The server alone reads and writes it. |

No INSERT / UPDATE / DELETE policy on any of them.

## Dry-run (25.11.2026, rolled back)

The migration plus a test block in one transaction that ends in an exception, on the live project; afterwards none of the three tables or the function existed. Results: claiming a pending row → 1 row, attempt 1, `sending`; while held → 0; after a failure → 1, attempt 2; a lapsed hold → 1, attempt 3; sent → 0; skipped → 0; `sending` without a hold and `pending` with one → refused (CHECK); a second row with the same `dedupe_key` → refused; one chat for a second account → refused; an e-mail row without an address → refused; a second e-mail row for a user → refused; an `email_verify` token without an address → refused. As a signed-in user: reads 2 own channels, 1 own notification, 0 tokens; another user reads 0 channels; an update touches 0 rows; an insert is refused (42501); the claim function is refused (42501).

## Notes

- Consumed by: `src/lib/notify/channels.ts` (channels, the confirmation page's state, linking), `tokens.ts`, `outbox.ts` (`deliver`), `send.ts` (`sendToOwner`); the approval card for `send_plan` reads `notification_channels` with the user's own session (`describe-writes.ts`).
- `npm run check:notify:db` checks every query against the live schema without writing: 15 of 15 on 25.11.2026, all three tables still empty afterwards.
- Advisors after the apply (25.11.2026): security — one new INFO, `rls_enabled_no_policy` on `channel_link_tokens`, which is the design (server-only; no policy means no access for `anon` / `authenticated`); performance — `unindexed_foreign_keys` on `notifications.plan_id`, fixed by the follow-up index (gone from the advisor afterwards), and `unused_index` on the new indexes (the tables are new and empty). Every other finding predates these tables.
