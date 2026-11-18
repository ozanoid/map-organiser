-- List items: a dense order, places that are the user's own, and an index
-- for "which lists is this place on".
--
-- Order. Inside a list `sort_order` is an ordering key, 0..n-1 with no ties
-- or gaps. Until now every add wrote 0 (three lists hold all of their 12–47
-- places at 0, 18.11.2026) and removals left gaps, so the order shown was
-- undefined. Existing rows are numbered by their old order, then by when
-- they were added. From here on save_list keeps the order dense.
with ranked as (
  select list_id, place_id,
         (row_number() over (partition by list_id
                             order by coalesce(sort_order, 0), added_at nulls last, place_id) - 1)::int as pos
  from public.list_places
)
update public.list_places lp
set sort_order = r.pos
from ranked r
where lp.list_id = r.list_id
  and lp.place_id = r.place_id
  and lp.sort_order is distinct from r.pos;

alter table public.list_places alter column sort_order set not null;

-- Access. The policy checked only that the list is the user's, so a client
-- could put another user's place id on its own list (no such row in the
-- data, 18.11.2026). New and changed rows must name the user's own place;
-- reads and deletes stay keyed on the list.
alter policy "Users manage own list_places" on public.list_places
  with check (
    list_id in (select id from public.lists where user_id = (select auth.uid()))
    and place_id in (select id from public.places where user_id = (select auth.uid()))
  );

-- The place page, Claude's get_places and place deletes look list items up
-- by place; the primary key starts with list_id.
create index list_places_place_id_idx on public.list_places (place_id);
