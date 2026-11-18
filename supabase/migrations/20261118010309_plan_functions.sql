-- The write path for plans. Every change that touches more than one row
-- happens inside one of these functions, so it is one transaction: a plan is
-- never left half-created, and a batch of edits applies completely or not at
-- all. (The trips code issued separate inserts and deletes from the API
-- route.)
--
-- SECURITY INVOKER: called with a user's token, row level security applies as
-- usual. The service role (cron, scripts) bypasses RLS, so the functions also
-- check ownership themselves through p_user_id.

-- ── Guards ───────────────────────────────────────────────────────────
create or replace function public.plan_assert_caller(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;
  -- A signed-in caller may only act for themselves; the service role has no
  -- auth.uid() and is trusted with the id it passes.
  if (select auth.uid()) is not null and (select auth.uid()) <> p_user_id then
    raise exception 'not allowed to act for another user' using errcode = '42501';
  end if;
end
$$;

-- ── One stop ─────────────────────────────────────────────────────────
-- p_stop: { place_id? | title?, start_time?, day_part?, notes?,
--           cost_estimate?, currency? }
create or replace function public.plan_insert_stop(
  p_user_id uuid,
  p_day_id  uuid,
  p_sort    integer,
  p_stop    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_place uuid := nullif(p_stop->>'place_id', '')::uuid;
  v_title text := nullif(btrim(coalesce(p_stop->>'title', '')), '');
  v_time  time := nullif(p_stop->>'start_time', '')::time;
  v_part  text := nullif(p_stop->>'day_part', '');
  v_id    uuid;
begin
  if v_place is null and v_title is null then
    raise exception 'a stop needs a place_id or a title' using errcode = '22023';
  end if;
  if v_place is not null and not exists (
    select 1 from places where id = v_place and user_id = p_user_id
  ) then
    raise exception 'place % is not one of this user''s places', v_place using errcode = '22023';
  end if;
  -- An exact time wins over a part of the day.
  if v_time is not null then
    v_part := null;
  end if;

  insert into plan_stops
    (day_id, sort_order, place_id, title, start_time, day_part, notes, cost_estimate, currency)
  values (
    p_day_id,
    p_sort,
    v_place,
    case when v_place is null then v_title end,
    v_time,
    v_part,
    nullif(p_stop->>'notes', ''),
    nullif(p_stop->>'cost_estimate', '')::numeric,
    coalesce(nullif(p_stop->>'currency', ''), 'USD')
  )
  returning id into v_id;
  return v_id;
end
$$;

-- ── Create a plan with its days and stops ────────────────────────────
-- p_plan: { name, start_date?, party_size?, notes?, color?, list_id?,
--           created_via?, days: [ { notes?, routing_profile?, stops: [stop] } ] }
-- A plan always has at least one day.
create or replace function public.create_plan(p_user_id uuid, p_plan jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_list_id uuid := nullif(p_plan->>'list_id', '')::uuid;
  v_day     jsonb;
  v_stop    jsonb;
  v_day_id  uuid;
  v_day_no  integer := 0;
  v_order   integer;
begin
  perform plan_assert_caller(p_user_id);

  if v_list_id is not null and not exists (
    select 1 from lists where id = v_list_id and user_id = p_user_id
  ) then
    raise exception 'list % is not one of this user''s lists', v_list_id using errcode = '22023';
  end if;

  insert into plans (user_id, name, start_date, party_size, notes, color, list_id, created_via)
  values (
    p_user_id,
    btrim(coalesce(p_plan->>'name', '')),
    nullif(p_plan->>'start_date', '')::date,
    coalesce(nullif(p_plan->>'party_size', '')::integer, 1),
    nullif(p_plan->>'notes', ''),
    coalesce(nullif(p_plan->>'color', ''), '#059669'),
    v_list_id,
    coalesce(nullif(p_plan->>'created_via', ''), 'app')
  )
  returning id into v_plan_id;

  for v_day in
    select value from jsonb_array_elements(coalesce(p_plan->'days', '[]'::jsonb))
  loop
    v_day_no := v_day_no + 1;
    insert into plan_days (plan_id, day_number, notes, routing_profile)
    values (
      v_plan_id,
      v_day_no,
      nullif(v_day->>'notes', ''),
      coalesce(nullif(v_day->>'routing_profile', ''), 'walking')
    )
    returning id into v_day_id;

    v_order := 0;
    for v_stop in
      select value from jsonb_array_elements(coalesce(v_day->'stops', '[]'::jsonb))
    loop
      perform plan_insert_stop(p_user_id, v_day_id, v_order, v_stop);
      v_order := v_order + 1;
    end loop;
  end loop;

  if v_day_no = 0 then
    insert into plan_days (plan_id, day_number) values (v_plan_id, 1);
  end if;

  return v_plan_id;
end
$$;

-- ── Change a plan ────────────────────────────────────────────────────
-- p_changes: {
--   set: { name?, notes?, party_size?, start_date?, status?, color? },
--         -- a key that is present is applied; start_date / notes null clears
--   ops: [ … applied in order … ]
-- }
-- ops:
--   { op: 'add_day',  position?, notes?, routing_profile? }   position 1-based, default = after the last day
--   { op: 'remove_day', day }                                 only an empty day; a plan keeps one day
--   { op: 'swap_days', a, b }
--   { op: 'set_day', day, notes?, routing_profile? }
--   { op: 'add_stop', day, position?, …stop }                 position 0-based, default = end of the day
--   { op: 'update_stop', stop_id, title?, start_time?, day_part?, notes?, cost_estimate?, currency?, status? }
--   { op: 'move_stop', stop_id, day, position? }
--   { op: 'remove_stop', stop_id }
--   { op: 'reorder_stops', day, stop_ids: [uuid, …] }         every stop of that day, in the new order
-- Returns { added_days: [day_number…], added_stops: [uuid…] }.
create or replace function public.apply_plan_changes(
  p_user_id uuid,
  p_plan_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_set     jsonb := coalesce(p_changes->'set', '{}'::jsonb);
  v_op      jsonb;
  v_kind    text;
  v_day_id  uuid;
  v_src_day uuid;
  v_stop_id uuid;
  v_day_no  integer;
  v_a       integer;
  v_b       integer;
  v_count   integer;
  v_pos     integer;
  v_old     integer;
  v_rows    integer;
  v_ids     uuid[];
  v_new_id  uuid;
  v_added_days  jsonb := '[]'::jsonb;
  v_added_stops jsonb := '[]'::jsonb;
begin
  perform plan_assert_caller(p_user_id);

  perform 1 from plans where id = p_plan_id and user_id = p_user_id for update;
  if not found then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  update plans set
    name       = case when v_set ? 'name' then btrim(coalesce(v_set->>'name', '')) else name end,
    notes      = case when v_set ? 'notes' then nullif(v_set->>'notes', '') else notes end,
    party_size = case when v_set ? 'party_size' then (v_set->>'party_size')::integer else party_size end,
    start_date = case when v_set ? 'start_date' then nullif(v_set->>'start_date', '')::date else start_date end,
    status     = case when v_set ? 'status' then v_set->>'status' else status end,
    color      = case when v_set ? 'color' then v_set->>'color' else color end,
    updated_at = now()
  where id = p_plan_id;

  -- Day numbers are shuffled in several statements; check uniqueness at the end.
  set constraints public.plan_days_plan_day_key deferred;

  for v_op in
    select value from jsonb_array_elements(coalesce(p_changes->'ops', '[]'::jsonb))
  loop
    v_kind := v_op->>'op';

    -- Resolve the day and/or the stop an op names, once.
    v_day_id := null;
    v_stop_id := null;
    if v_op ? 'day' then
      v_day_no := (v_op->>'day')::integer;
      select id into v_day_id from plan_days where plan_id = p_plan_id and day_number = v_day_no;
      if v_day_id is null then
        raise exception 'day % does not exist in this plan', v_day_no using errcode = '22023';
      end if;
    end if;
    if v_op ? 'stop_id' then
      select s.id, s.day_id, s.sort_order into v_stop_id, v_src_day, v_old
      from plan_stops s
      join plan_days d on d.id = s.day_id
      where s.id = (v_op->>'stop_id')::uuid and d.plan_id = p_plan_id;
      if v_stop_id is null then
        raise exception 'stop % does not belong to this plan', v_op->>'stop_id' using errcode = '22023';
      end if;
    end if;

    if v_kind = 'add_day' then
      select count(*) into v_count from plan_days where plan_id = p_plan_id;
      v_pos := least(greatest(coalesce((v_op->>'position')::integer, v_count + 1), 1), v_count + 1);
      update plan_days set day_number = day_number + 1
      where plan_id = p_plan_id and day_number >= v_pos;
      insert into plan_days (plan_id, day_number, notes, routing_profile)
      values (
        p_plan_id,
        v_pos,
        nullif(v_op->>'notes', ''),
        coalesce(nullif(v_op->>'routing_profile', ''), 'walking')
      );
      v_added_days := v_added_days || to_jsonb(v_pos);

    elsif v_kind = 'remove_day' then
      if v_day_id is null then
        raise exception 'remove_day needs day' using errcode = '22023';
      end if;
      select count(*) into v_count from plan_days where plan_id = p_plan_id;
      if v_count <= 1 then
        raise exception 'a plan keeps at least one day' using errcode = '22023';
      end if;
      select count(*) into v_rows from plan_stops where day_id = v_day_id;
      if v_rows > 0 then
        raise exception 'day % still has % stop(s); move or remove them first', v_day_no, v_rows
          using errcode = '22023';
      end if;
      delete from plan_days where id = v_day_id;
      update plan_days set day_number = day_number - 1
      where plan_id = p_plan_id and day_number > v_day_no;

    elsif v_kind = 'swap_days' then
      v_a := (v_op->>'a')::integer;
      v_b := (v_op->>'b')::integer;
      if v_a is null or v_b is null or v_a = v_b then
        raise exception 'swap_days needs two different days' using errcode = '22023';
      end if;
      update plan_days
      set day_number = case day_number when v_a then v_b else v_a end
      where plan_id = p_plan_id and day_number in (v_a, v_b);
      get diagnostics v_rows = row_count;
      if v_rows <> 2 then
        raise exception 'days % and % do not both exist in this plan', v_a, v_b using errcode = '22023';
      end if;

    elsif v_kind = 'set_day' then
      if v_day_id is null then
        raise exception 'set_day needs day' using errcode = '22023';
      end if;
      update plan_days set
        notes = case when v_op ? 'notes' then nullif(v_op->>'notes', '') else notes end,
        routing_profile = case when v_op ? 'routing_profile' then v_op->>'routing_profile' else routing_profile end
      where id = v_day_id;

    elsif v_kind = 'add_stop' then
      if v_day_id is null then
        raise exception 'add_stop needs day' using errcode = '22023';
      end if;
      select count(*) into v_count from plan_stops where day_id = v_day_id;
      v_pos := least(greatest(coalesce((v_op->>'position')::integer, v_count), 0), v_count);
      update plan_stops set sort_order = sort_order + 1
      where day_id = v_day_id and sort_order >= v_pos;
      v_new_id := plan_insert_stop(p_user_id, v_day_id, v_pos, v_op);
      v_added_stops := v_added_stops || to_jsonb(v_new_id);

    elsif v_kind = 'update_stop' then
      if v_stop_id is null then
        raise exception 'update_stop needs stop_id' using errcode = '22023';
      end if;
      update plan_stops set
        title = case
          when v_op ? 'title' and place_id is null then nullif(btrim(coalesce(v_op->>'title', '')), '')
          else title end,
        -- Setting one of time / day part clears the other.
        start_time = case
          when v_op ? 'start_time' then nullif(v_op->>'start_time', '')::time
          when v_op ? 'day_part' and nullif(v_op->>'day_part', '') is not null then null
          else start_time end,
        day_part = case
          when v_op ? 'start_time' and nullif(v_op->>'start_time', '') is not null then null
          when v_op ? 'day_part' then nullif(v_op->>'day_part', '')
          else day_part end,
        notes = case when v_op ? 'notes' then nullif(v_op->>'notes', '') else notes end,
        cost_estimate = case
          when v_op ? 'cost_estimate' then nullif(v_op->>'cost_estimate', '')::numeric
          else cost_estimate end,
        currency = case
          when v_op ? 'currency' then coalesce(nullif(v_op->>'currency', ''), 'USD')
          else currency end,
        status_at = case
          when v_op ? 'status' and (v_op->>'status') is distinct from status then now()
          else status_at end,
        status = case when v_op ? 'status' then v_op->>'status' else status end
      where id = v_stop_id;

    elsif v_kind = 'move_stop' then
      if v_stop_id is null or v_day_id is null then
        raise exception 'move_stop needs stop_id and day' using errcode = '22023';
      end if;
      -- Take it out of its day, then put it into the target day.
      update plan_stops set sort_order = sort_order - 1
      where day_id = v_src_day and sort_order > v_old;
      select count(*) into v_count from plan_stops where day_id = v_day_id and id <> v_stop_id;
      v_pos := least(greatest(coalesce((v_op->>'position')::integer, v_count), 0), v_count);
      update plan_stops set sort_order = sort_order + 1
      where day_id = v_day_id and id <> v_stop_id and sort_order >= v_pos;
      update plan_stops set day_id = v_day_id, sort_order = v_pos where id = v_stop_id;

    elsif v_kind = 'remove_stop' then
      if v_stop_id is null then
        raise exception 'remove_stop needs stop_id' using errcode = '22023';
      end if;
      delete from plan_stops where id = v_stop_id;
      update plan_stops set sort_order = sort_order - 1
      where day_id = v_src_day and sort_order > v_old;

    elsif v_kind = 'reorder_stops' then
      if v_day_id is null then
        raise exception 'reorder_stops needs day' using errcode = '22023';
      end if;
      select array_agg(value::uuid order by ord) into v_ids
      from jsonb_array_elements_text(coalesce(v_op->'stop_ids', '[]'::jsonb)) with ordinality as t(value, ord);
      select count(*) into v_count from plan_stops where day_id = v_day_id;
      if coalesce(array_length(v_ids, 1), 0) <> v_count then
        raise exception 'reorder_stops needs every stop of day % (% stops)', v_day_no, v_count
          using errcode = '22023';
      end if;
      update plan_stops s set sort_order = o.ord - 1
      from unnest(v_ids) with ordinality as o(id, ord)
      where s.id = o.id and s.day_id = v_day_id;
      get diagnostics v_rows = row_count;
      if v_rows <> v_count then
        raise exception 'reorder_stops lists a stop that is not in day %', v_day_no using errcode = '22023';
      end if;

    else
      raise exception 'unknown op %', coalesce(v_kind, '(none)') using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('added_days', v_added_days, 'added_stops', v_added_stops);
end
$$;

-- Only signed-in users and the service role call these.
revoke execute on function public.plan_assert_caller(uuid) from public, anon;
revoke execute on function public.plan_insert_stop(uuid, uuid, integer, jsonb) from public, anon;
revoke execute on function public.create_plan(uuid, jsonb) from public, anon;
revoke execute on function public.apply_plan_changes(uuid, uuid, jsonb) from public, anon;
grant execute on function public.plan_assert_caller(uuid) to authenticated, service_role;
grant execute on function public.plan_insert_stop(uuid, uuid, integer, jsonb) to authenticated, service_role;
grant execute on function public.create_plan(uuid, jsonb) to authenticated, service_role;
grant execute on function public.apply_plan_changes(uuid, uuid, jsonb) to authenticated, service_role;
