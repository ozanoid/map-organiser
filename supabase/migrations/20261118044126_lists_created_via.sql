-- Who made a list — the app or the assistant — as plans and visits record
-- it. It can't be filled in later, so it starts now; every existing list
-- was made in the app.
alter table public.lists
  add column created_via text not null default 'app'
  check (created_via in ('app', 'assistant'));
