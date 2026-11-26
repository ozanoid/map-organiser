-- Phase 3, slice 2 (design: docs/_plans/phase-3-communication.md):
-- reminders before a plan and the weekly summary, sent by a scheduler.
-- Additive only: nothing the running code reads changes.
--
--   profiles.time_zone — the user's IANA time zone ("Europe/London"), taken
--     from the browser once and changed in Settings. A plan's reminders are
--     timed where the plan is (its first stop at a place with a zone); a plan
--     with no such stop is timed in this zone, and so is the weekly summary.
--     Written with the user's own session, like the rest of the profile.
--   notification_settings — one row per user, written when they change a
--     setting; no row means the defaults (Ozan, 26.11.2026: the evening
--     before at 18:00 and the morning of at 08:00, the weekly summary on
--     Mondays at 08:00, every connected channel). The defaults live in the
--     code alone, so they are in one place. Read by its user, written by the
--     server only (like notification_channels).
--   notifications.skip_reason — a reminder or summary that came due but was
--     not sent is recorded as skipped, with why: 'late' (more than three
--     hours past its time: the scheduler missed it), 'changed' (the plan was
--     made or changed after its time), 'empty' (a weekly summary with no plan
--     that week). The record also keeps the next run from weighing it again.

alter table public.profiles
  add column time_zone text
    check (time_zone is null or (length(time_zone) <= 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'));

create table public.notification_settings (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  reminder_channels     text[] not null,
  reminder_evening_time time,               -- the evening before the plan; null = none
  reminder_morning_time time,               -- the morning of the plan; null = none
  weekly_channels       text[] not null,
  weekly_day            smallint not null check (weekly_day between 1 and 7),  -- ISO weekday, 1 = Monday
  weekly_time           time,               -- null = no weekly summary
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (reminder_channels <@ array['email', 'telegram']::text[]),
  check (weekly_channels <@ array['email', 'telegram']::text[])
);

alter table public.notification_settings enable row level security;

create policy "Users read own notification settings" on public.notification_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- notification_settings: no write policy — the server alone writes it.

alter table public.notifications
  add column skip_reason text check (skip_reason in ('late', 'changed', 'empty')),
  add constraint notifications_skipped_has_reason check ((status = 'skipped') = (skip_reason is not null));
