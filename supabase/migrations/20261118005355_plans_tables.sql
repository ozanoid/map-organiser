-- Plans: the single planning model. An evening outing and a multi-day trip
-- are the same thing — a plan with 1..N days of ordered stops.
--
-- Replaces trips / trip_days / trip_day_places. This migration is the EXPAND
-- step: it only adds tables and copies the existing rows (same ids), so the
-- running code keeps working on the old tables until the cutover. The old
-- tables are dropped in a later, separate migration.
--
-- Dates live in ONE place: plans.start_date. A day's date is
-- start_date + (day_number - 1); the end date is start_date + days - 1.
-- A plan without start_date is not scheduled yet.

-- ── plans ────────────────────────────────────────────────────────────
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  start_date  date,
  status      text not null default 'planned'
                check (status in ('planned', 'cancelled')),
  party_size  integer not null default 1 check (party_size between 1 and 50),
  notes       text,
  color       text default '#059669',
  -- The shortlist the plan was built from, if any. Deleting the list keeps
  -- the plan (trips.list_id had no delete rule and blocked the delete).
  list_id     uuid references public.lists (id) on delete set null,
  -- Who created it: the app's own UI or an assistant tool. Cannot be
  -- reconstructed later, so it is recorded from the start.
  created_via text not null default 'app'
                check (created_via in ('app', 'assistant')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index plans_user_start_idx on public.plans (user_id, start_date);
create index plans_list_idx on public.plans (list_id) where list_id is not null;

-- ── plan_days ────────────────────────────────────────────────────────
create table public.plan_days (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.plans (id) on delete cascade,
  day_number      integer not null check (day_number >= 1),
  notes           text,
  routing_profile text not null default 'walking'
                    check (routing_profile in ('walking', 'driving', 'cycling')),
  created_at      timestamptz not null default now(),
  -- Deferrable so two days can swap their numbers inside one transaction.
  constraint plan_days_plan_day_key
    unique (plan_id, day_number) deferrable initially immediate
);

-- ── plan_stops ───────────────────────────────────────────────────────
create table public.plan_stops (
  id            uuid primary key default gen_random_uuid(),
  day_id        uuid not null references public.plan_days (id) on delete cascade,
  sort_order    integer not null default 0,
  -- A saved place, or a free-text stop ("meet at Old Street exit").
  place_id      uuid references public.places (id) on delete cascade,
  title         text,
  -- Either an exact local time at the place, or a part of the day.
  start_time    time,
  day_part      text check (day_part in ('morning', 'afternoon', 'evening', 'night')),
  notes         text,
  cost_estimate numeric check (cost_estimate is null or cost_estimate >= 0),
  currency      text default 'USD',
  status        text not null default 'planned'
                  check (status in ('planned', 'done', 'skipped')),
  status_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint plan_stops_place_or_title
    check (place_id is not null or nullif(btrim(title), '') is not null),
  constraint plan_stops_time_or_part
    check (start_time is null or day_part is null)
);

create index plan_stops_day_idx on public.plan_stops (day_id, sort_order);
create index plan_stops_place_idx on public.plan_stops (place_id) where place_id is not null;

-- ── Row level security ───────────────────────────────────────────────
alter table public.plans      enable row level security;
alter table public.plan_days  enable row level security;
alter table public.plan_stops enable row level security;

create policy "Users manage own plans" on public.plans
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      list_id is null
      or list_id in (select l.id from public.lists l where l.user_id = (select auth.uid()))
    )
  );

create policy "Users manage own plan days" on public.plan_days
  for all to authenticated
  using (
    plan_id in (select p.id from public.plans p where p.user_id = (select auth.uid()))
  )
  with check (
    plan_id in (select p.id from public.plans p where p.user_id = (select auth.uid()))
  );

-- A stop may only point at one of the user's OWN places: the public share
-- view reads plans with the service role, so a foreign place id attached to
-- a stop would leak that place. (The trips code guarded this in the route.)
create policy "Users manage own plan stops" on public.plan_stops
  for all to authenticated
  using (
    day_id in (
      select d.id
      from public.plan_days d
      join public.plans p on p.id = d.plan_id
      where p.user_id = (select auth.uid())
    )
  )
  with check (
    day_id in (
      select d.id
      from public.plan_days d
      join public.plans p on p.id = d.plan_id
      where p.user_id = (select auth.uid())
    )
    and (
      place_id is null
      or place_id in (select pl.id from public.places pl where pl.user_id = (select auth.uid()))
    )
  );

-- ── Copy the existing trips (same ids, so links keep working) ────────
-- Checked on 18.11.2026: 7 trips / 40 days / 127 stops; no duplicate or
-- missing day numbers; every day's date equals start_date + day_number - 1;
-- time_slot holds only morning / afternoon / evening / night or NULL.
insert into public.plans
  (id, user_id, name, start_date, party_size, notes, color, list_id, created_at, updated_at)
select
  id, user_id, name, start_date, party_size, notes, color, list_id,
  coalesce(created_at, now()), coalesce(updated_at, now())
from public.trips;

insert into public.plan_days (id, plan_id, day_number, notes, routing_profile, created_at)
select id, trip_id, day_number, notes, routing_profile, coalesce(created_at, now())
from public.trip_days;

insert into public.plan_stops
  (id, day_id, sort_order, place_id, start_time, day_part, notes, cost_estimate, currency, created_at)
select
  id,
  trip_day_id,
  coalesce(sort_order, 0),
  place_id,
  case when time_slot ~ '^([01]?\d|2[0-3]):[0-5]\d$' then time_slot::time end,
  case when time_slot in ('morning', 'afternoon', 'evening', 'night') then time_slot end,
  -- Any other free text in time_slot is kept in front of the note.
  case
    when time_slot is null
      or time_slot in ('morning', 'afternoon', 'evening', 'night')
      or time_slot ~ '^([01]?\d|2[0-3]):[0-5]\d$'
    then notes
    else concat_ws(' — ', time_slot, notes)
  end,
  cost_estimate,
  currency,
  coalesce(created_at, now())
from public.trip_day_places;

-- ── Shared links: accept 'plan' next to 'trip' until the cutover ─────
alter table public.shared_links drop constraint shared_links_resource_type_check;
alter table public.shared_links add constraint shared_links_resource_type_check
  check (resource_type = any (array['list', 'trip', 'plan', 'place']));
