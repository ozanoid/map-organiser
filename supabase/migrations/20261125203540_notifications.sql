-- Phase 3, slice 1 (design: docs/_plans/phase-3-communication.md):
-- the owner's own channels — e-mail and Telegram — and a record of every
-- message the app sends.
--
-- Three tables, all new; nothing existing changes:
--   notification_channels — where a user gets messages: one e-mail address
--     (confirmed by a one-time link before anything but that confirmation is
--     sent to it) and one Telegram chat (linked through the bot).
--   channel_link_tokens — the one-time tokens of those two links. Only the
--     token's SHA-256 is kept; the token itself lives in the link alone.
--   notifications — every message sent or to be sent: what kind, which
--     channel, for which plan, when it is due, how the sending went and a copy
--     of what went out (the plan may change later; what was sent can't be
--     rebuilt). `dedupe_key` is unique: the same message can't be written
--     twice (later slices: one reminder per plan, day and channel).
--
-- Every write goes through the server with the service role, scoped to the
-- user in code; users only read their own rows. With no write policies a
-- signed-in user can't mark an address confirmed or point a channel at
-- someone else's chat through the REST API.

create table public.notification_channels (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('email', 'telegram')),
  email             text check (email is null or (length(email) <= 254 and email like '%_@_%')),
  telegram_chat_id  bigint,                 -- up to 52 bits (Telegram)
  telegram_username text,
  verified_at       timestamptz,            -- e-mail: its link was opened; Telegram: linked
  disabled_at       timestamptz,            -- stopped working (bot blocked) — nothing is sent while set
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, kind),
  check (
    (kind = 'email' and email is not null and telegram_chat_id is null)
    or (kind = 'telegram' and telegram_chat_id is not null and email is null)
  )
);

-- One Telegram chat belongs to one account.
create unique index notification_channels_telegram_chat_key
  on public.notification_channels (telegram_chat_id)
  where kind = 'telegram';

create table public.channel_link_tokens (
  token_hash text primary key,              -- SHA-256 (hex) of the token
  user_id    uuid not null references auth.users (id) on delete cascade,
  purpose    text not null check (purpose in ('email_verify', 'telegram_link')),
  email      text,                          -- email_verify: the address it confirms
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  check ((purpose = 'email_verify') = (email is not null))
);

create index channel_link_tokens_user_idx on public.channel_link_tokens (user_id, created_at desc);

create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  kind                text not null check (kind in (
                        'email_verify', 'channel_test', 'plan_summary',
                        'plan_reminder', 'weekly_summary', 'rsvp_received')),
  channel             text not null check (channel in ('email', 'telegram')),
  plan_id             uuid references public.plans (id) on delete set null,
  dedupe_key          text not null unique,
  due_at              timestamptz not null default now(),
  status              text not null default 'pending'
                        check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            smallint not null default 0 check (attempts >= 0),
  claimed_until       timestamptz,          -- 'sending': the sender holds the row until then
  last_error          text,
  provider_message_id text,
  content             jsonb,                -- what went out: { to, subject?, text }
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  -- A hold belongs to a row being sent, and every row being sent has one.
  check ((status = 'sending') = (claimed_until is not null))
);

create index notifications_due_idx on public.notifications (due_at)
  where status in ('pending', 'sending', 'failed');
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ── Claiming a message to send ───────────────────────────────────────
-- One sender at a time. A pending or failed row — or one still marked
-- 'sending' whose hold has lapsed: its sender died between claiming and
-- recording — is marked 'sending', its attempt counted and held for
-- p_lease_seconds. Returns the row, or nothing when another sender holds it
-- or it was sent (or skipped) already.
--
-- A lapsed hold is taken over rather than given up: a lost reminder is worse
-- than a rare second copy, and e-mail can't come twice anyway — Resend's
-- idempotency key (the row id) holds for 24 hours.
create function public.notification_claim(p_id uuid, p_lease_seconds integer default 120)
returns setof public.notifications
language sql
security invoker
set search_path = ''
as $function$
  update public.notifications
     set status = 'sending',
         attempts = attempts + 1,
         claimed_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_id
     and (status in ('pending', 'failed')
          or (status = 'sending' and claimed_until < now()))
  returning *;
$function$;

revoke execute on function public.notification_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.notification_claim(uuid, integer) to service_role;

-- ── Row level security ───────────────────────────────────────────────
alter table public.notification_channels enable row level security;
alter table public.channel_link_tokens   enable row level security;
alter table public.notifications         enable row level security;

create policy "Users read own notification channels" on public.notification_channels
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read own notifications" on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- channel_link_tokens: no policy — the server alone reads and writes it.
