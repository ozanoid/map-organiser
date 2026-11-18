-- Visits: what actually happened — "I was at this place on this date".
--
-- Until now a visit was flattened onto the place (visit_status, rating,
-- notes), so a second visit, its own rating or what was eaten that day had
-- nowhere to go. A visit can come from a plan stop (plan_stop_id) or be
-- logged on its own. The place keeps its summary fields (visit_status,
-- rating); logging a visit updates them.

create table public.visits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  place_id     uuid not null references public.places (id) on delete cascade,
  -- Local date at the place.
  visited_on   date not null,
  rating       smallint check (rating between 1 and 5),
  -- What I ate, how it was.
  notes        text,
  -- The planned stop this visit fulfils, if any; one visit per stop.
  plan_stop_id uuid references public.plan_stops (id) on delete set null,
  -- app = the UI, assistant = a tool call, feedback = a reply to a
  -- "did you go?" message (Phase 4).
  created_via  text not null default 'app'
                 check (created_via in ('app', 'assistant', 'feedback')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint visits_plan_stop_key unique (plan_stop_id)
);

create index visits_user_date_idx on public.visits (user_id, visited_on desc);
create index visits_place_idx on public.visits (place_id, visited_on desc);

alter table public.visits enable row level security;

create policy "Users manage own visits" on public.visits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and place_id in (select pl.id from public.places pl where pl.user_id = (select auth.uid()))
    and (
      plan_stop_id is null
      or plan_stop_id in (
        select s.id
        from public.plan_stops s
        join public.plan_days d on d.id = s.day_id
        join public.plans p on p.id = d.plan_id
        where p.user_id = (select auth.uid())
      )
    )
  );
