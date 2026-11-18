-- The write path for visits, like plan_functions for plans: every change is
-- one call, so it is one transaction — the visit, the place's summary (visit
-- status, rating) and the plan stop it fulfils change together or not at all.
--
-- Rules (Ozan, 18.11.2026):
-- - A visit is one place on one day. Logging the same place and day again
--   updates that visit; fields that are left out are kept.
-- - Logging a visit marks the place visited (a favourite stays a favourite).
--   Deleting a visit doesn't unmark it: "visited" can be set without a visit.
-- - The place's rating follows its latest rated visit. It changes only when
--   that latest rated visit changes — a later visit, its rating edited, it
--   deleted — so a star given by hand on the place page stays until then.
--   When the last rated visit goes and the place still shows its rating, the
--   rating is cleared.
-- - A visit can fulfil a planned stop: named by plan_stop_id, or found — a
--   stop of a planned (not cancelled) plan, still planned, at the same place,
--   on the same day. The stop becomes done; deleting the visit reopens it.
-- - No visit in the future (one day of slack for time zones ahead of UTC).
--
-- SECURITY INVOKER: RLS applies to a signed-in caller. The service role
-- bypasses RLS, so ownership is also checked through p_user_id.

-- ── The place's rating after its visits changed ──────────────────────
-- p_before_*: the latest rated visit before the change.
create or replace function public.visit_sync_rating(
  p_place_id      uuid,
  p_before_id     uuid,
  p_before_rating smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_after_id     uuid;
  v_after_rating smallint;
begin
  select id, rating into v_after_id, v_after_rating
  from visits
  where place_id = p_place_id and rating is not null
  order by visited_on desc, created_at desc
  limit 1;

  if v_after_id is not distinct from p_before_id
     and v_after_rating is not distinct from p_before_rating then
    return; -- the latest rated visit is the same: a hand-given rating stays
  end if;

  if v_after_id is not null then
    update places set rating = v_after_rating, updated_at = now()
    where id = p_place_id and rating is distinct from v_after_rating;
  else
    -- No rated visit left: clear the rating if it was the one that went.
    update places set rating = null, updated_at = now()
    where id = p_place_id and rating is not distinct from p_before_rating;
  end if;
end
$$;

-- ── Log or correct a visit ───────────────────────────────────────────
-- p_visit:
--   { visit_id, visited_on?, rating?, notes? }
--       correct a visit: keys that are present are applied; rating / notes
--       null clears them. The place and the stop of a visit don't change.
--   { place_id? , plan_stop_id?, visited_on, rating?, notes?, created_via? }
--       log a visit: place_id, or the place of plan_stop_id. A visit to that
--       place on that day already → it is updated (keys left out are kept).
-- Returns { visit, created, place: { id, visit_status, rating } }.
create or replace function public.log_visit(p_user_id uuid, p_visit jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_visit_id   uuid := nullif(p_visit->>'visit_id', '')::uuid;
  v_place      uuid := nullif(p_visit->>'place_id', '')::uuid;
  v_stop       uuid := nullif(p_visit->>'plan_stop_id', '')::uuid;
  v_on         date := nullif(p_visit->>'visited_on', '')::date;
  v_rating     smallint := nullif(p_visit->>'rating', '')::smallint;
  v_notes      text := nullif(btrim(coalesce(p_visit->>'notes', '')), '');
  v_stop_place uuid;
  v_found      boolean;
  v_row        visits%rowtype;
  v_created    boolean := false;
  v_before_id     uuid;
  v_before_rating smallint;
  v_status     text;
  v_place_rating smallint;
begin
  perform plan_assert_caller(p_user_id);

  if v_rating is not null and v_rating not between 1 and 5 then
    raise exception 'a rating is 1 to 5' using errcode = '22023';
  end if;
  if v_on is not null and v_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'a visit can''t be in the future (%)', v_on using errcode = '22023';
  end if;

  if v_visit_id is not null then
    -- ── Correct a visit ──
    select * into v_row from visits where id = v_visit_id and user_id = p_user_id;
    if not found then
      raise exception 'visit not found' using errcode = 'P0002';
    end if;
    perform 1 from places where id = v_row.place_id for update;

    select id, rating into v_before_id, v_before_rating
    from visits where place_id = v_row.place_id and rating is not null
    order by visited_on desc, created_at desc limit 1;

    if v_on is not null and v_on <> v_row.visited_on and exists (
      select 1 from visits
      where user_id = p_user_id and place_id = v_row.place_id and visited_on = v_on
    ) then
      raise exception 'there is already a visit to this place on %', v_on using errcode = '22023';
    end if;

    update visits set
      visited_on = coalesce(v_on, visited_on),
      rating     = case when p_visit ? 'rating' then v_rating else rating end,
      notes      = case when p_visit ? 'notes' then v_notes else notes end,
      updated_at = now()
    where id = v_visit_id
    returning * into v_row;
  else
    -- ── Log a visit ──
    if v_stop is not null then
      select s.place_id, true into v_stop_place, v_found
      from plan_stops s
      join plan_days d on d.id = s.day_id
      join plans p on p.id = d.plan_id
      where s.id = v_stop and p.user_id = p_user_id;
      if v_found is null then
        raise exception 'stop % is not part of this user''s plans', v_stop using errcode = '22023';
      end if;
      if v_stop_place is null then
        raise exception 'that stop has no saved place; mark it done instead of logging a visit'
          using errcode = '22023';
      end if;
      if v_place is null then
        v_place := v_stop_place;
      elsif v_place <> v_stop_place then
        raise exception 'that stop is at another place' using errcode = '22023';
      end if;
    end if;
    if v_place is null then
      raise exception 'a visit needs a place_id' using errcode = '22023';
    end if;
    if v_on is null then
      raise exception 'a visit needs visited_on' using errcode = '22023';
    end if;

    perform 1 from places where id = v_place and user_id = p_user_id for update;
    if not found then
      raise exception 'place % is not one of this user''s places', v_place using errcode = '22023';
    end if;

    select id, rating into v_before_id, v_before_rating
    from visits where place_id = v_place and rating is not null
    order by visited_on desc, created_at desc limit 1;

    select * into v_row from visits
    where user_id = p_user_id and place_id = v_place and visited_on = v_on;
    if found then
      if v_stop is not null and v_row.plan_stop_id is not null and v_row.plan_stop_id <> v_stop then
        raise exception 'the visit on % already fulfils another planned stop', v_on using errcode = '22023';
      end if;
      update visits set
        rating       = case when p_visit ? 'rating' then v_rating else rating end,
        notes        = case when p_visit ? 'notes' then v_notes else notes end,
        plan_stop_id = coalesce(plan_stop_id, v_stop),
        updated_at   = now()
      where id = v_row.id
      returning * into v_row;
    else
      if v_stop is not null and exists (select 1 from visits where plan_stop_id = v_stop) then
        raise exception 'that stop already has a visit on another day' using errcode = '22023';
      end if;
      insert into visits (user_id, place_id, visited_on, rating, notes, plan_stop_id, created_via)
      values (
        p_user_id, v_place, v_on, v_rating, v_notes, v_stop,
        coalesce(nullif(p_visit->>'created_via', ''), 'app')
      )
      returning * into v_row;
      v_created := true;
    end if;

    -- The place is visited now (a favourite stays a favourite).
    update places set
      visit_status = 'visited',
      visited_at   = coalesce(visited_at, now()),
      updated_at   = now()
    where id = v_place
      and visit_status is distinct from 'visited'
      and visit_status is distinct from 'favorite';
  end if;

  -- A planned stop at this place on this day, if the visit fulfils none yet.
  if v_row.plan_stop_id is null then
    select s.id into v_stop
    from plan_stops s
    join plan_days d on d.id = s.day_id
    join plans p on p.id = d.plan_id
    where p.user_id = p_user_id
      and p.status = 'planned'
      and p.start_date is not null
      and p.start_date + (d.day_number - 1) = v_row.visited_on
      and s.place_id = v_row.place_id
      and s.status = 'planned'
      and not exists (select 1 from visits v where v.plan_stop_id = s.id)
    order by p.created_at, d.day_number, s.sort_order
    limit 1;
    if v_stop is not null then
      update visits set plan_stop_id = v_stop where id = v_row.id returning * into v_row;
    end if;
  end if;

  if v_row.plan_stop_id is not null then
    update plan_stops set status = 'done', status_at = now()
    where id = v_row.plan_stop_id and status <> 'done';
  end if;

  perform visit_sync_rating(v_row.place_id, v_before_id, v_before_rating);

  select visit_status, rating into v_status, v_place_rating from places where id = v_row.place_id;
  return jsonb_build_object(
    'visit', to_jsonb(v_row) - 'user_id',
    'created', v_created,
    'place', jsonb_build_object('id', v_row.place_id, 'visit_status', v_status, 'rating', v_place_rating)
  );
end
$$;

-- ── Delete a visit ───────────────────────────────────────────────────
-- Returns { deleted, place: { id, visit_status, rating }, reopened_stop_id }.
create or replace function public.delete_visit(p_user_id uuid, p_visit_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row           visits%rowtype;
  v_before_id     uuid;
  v_before_rating smallint;
  v_status        text;
  v_place_rating  smallint;
begin
  perform plan_assert_caller(p_user_id);

  select * into v_row from visits where id = p_visit_id and user_id = p_user_id;
  if not found then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  perform 1 from places where id = v_row.place_id for update;

  select id, rating into v_before_id, v_before_rating
  from visits where place_id = v_row.place_id and rating is not null
  order by visited_on desc, created_at desc limit 1;

  delete from visits where id = p_visit_id;

  -- The stop it fulfilled is planned again.
  if v_row.plan_stop_id is not null then
    update plan_stops set status = 'planned', status_at = now()
    where id = v_row.plan_stop_id and status = 'done';
  end if;

  perform visit_sync_rating(v_row.place_id, v_before_id, v_before_rating);

  select visit_status, rating into v_status, v_place_rating from places where id = v_row.place_id;
  return jsonb_build_object(
    'deleted', p_visit_id,
    'place', jsonb_build_object('id', v_row.place_id, 'visit_status', v_status, 'rating', v_place_rating),
    'reopened_stop_id', v_row.plan_stop_id
  );
end
$$;

-- Only signed-in users and the service role call these.
revoke execute on function public.visit_sync_rating(uuid, uuid, smallint) from public, anon;
revoke execute on function public.log_visit(uuid, jsonb) from public, anon;
revoke execute on function public.delete_visit(uuid, uuid) from public, anon;
grant execute on function public.visit_sync_rating(uuid, uuid, smallint) to authenticated, service_role;
grant execute on function public.log_visit(uuid, jsonb) to authenticated, service_role;
grant execute on function public.delete_visit(uuid, uuid) to authenticated, service_role;
