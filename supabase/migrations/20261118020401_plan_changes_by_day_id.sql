-- apply_plan_changes, second version (the first is in …010309_plan_functions.sql).
-- Three changes, all found by reviewing the code that calls it:
--
-- 1. A day can be named by its id (`day_id`, `a_id` / `b_id` for a swap) as
--    well as by its number. A screen showing a plan sends ids: if the days
--    were renumbered meanwhile — a queued "remove day 1", an edit in another
--    tab — the change still lands on the day that was shown, and a day that
--    is gone is an error instead of a silent write to another day. Numbers
--    stay for callers that think in dates ("day 2 is the Saturday").
--
-- 2. Stop order is made dense (0..n-1 per day) before the ops run. Positions
--    are indexes, sort_order is only an ordering key, and nothing kept the
--    two equal: deleting a place removes its stops through the foreign key
--    and leaves a gap, and the rows copied from the trip tables came with
--    gaps (2 of 40 days on 18.11.2026). With a gap, "add at the end" landed
--    in the middle.
--
-- 3. Limits the callers already assume: 60 days a plan, 200 stops a day.
--
-- ops — a day is named by `day` (its number, 1-based) or by `day_id`:
--   { op: 'add_day',  position?, notes?, routing_profile? }   position 1-based, default = after the last day
--   { op: 'remove_day', day | day_id }                        only an empty day; a plan keeps one day
--   { op: 'swap_days', a, b }  or  { op: 'swap_days', a_id, b_id }
--   { op: 'set_day', day | day_id, notes?, routing_profile? }
--   { op: 'add_stop', day | day_id, position?, …stop }        position 0-based, default = end of the day
--   { op: 'update_stop', stop_id, title?, start_time?, day_part?, notes?, cost_estimate?, currency?, status? }
--   { op: 'move_stop', stop_id, day | day_id, position? }
--   { op: 'remove_stop', stop_id }
--   { op: 'reorder_stops', day | day_id, stop_ids: [uuid, …] }  every stop of that day, in the new order
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

  -- sort_order is an ordering key; the positions the ops take are indexes.
  -- Close any gaps first, so the two agree: deleting a place takes its stops
  -- with it (FK cascade) and leaves one, and the rows copied from the trip
  -- tables came with theirs.
  update plan_stops s set sort_order = o.rn
  from (
    select s2.id,
           row_number() over (partition by s2.day_id order by s2.sort_order, s2.created_at, s2.id) - 1 as rn
    from plan_stops s2
    join plan_days d on d.id = s2.day_id
    where d.plan_id = p_plan_id
  ) o
  where s.id = o.id and s.sort_order <> o.rn;

  for v_op in
    select value from jsonb_array_elements(coalesce(p_changes->'ops', '[]'::jsonb))
  loop
    v_kind := v_op->>'op';

    -- Resolve the day and/or the stop an op names, once.
    v_day_id := null;
    v_day_no := null;
    v_stop_id := null;
    if v_op ? 'day_id' then
      -- By identity: what a screen that shows the plan sends. If the days
      -- were renumbered meanwhile the op still lands on the day that was
      -- shown, and a day that is gone is an error instead of another day.
      select id, day_number into v_day_id, v_day_no
      from plan_days where id = (v_op->>'day_id')::uuid and plan_id = p_plan_id;
      if v_day_id is null then
        raise exception 'that day is no longer part of this plan' using errcode = '22023';
      end if;
    elsif v_op ? 'day' then
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
      if v_count >= 60 then
        raise exception 'a plan holds at most 60 days' using errcode = '22023';
      end if;
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
      if v_op ? 'a_id' or v_op ? 'b_id' then
        select day_number into v_a from plan_days where id = (v_op->>'a_id')::uuid and plan_id = p_plan_id;
        select day_number into v_b from plan_days where id = (v_op->>'b_id')::uuid and plan_id = p_plan_id;
      else
        v_a := (v_op->>'a')::integer;
        v_b := (v_op->>'b')::integer;
      end if;
      if v_a is null or v_b is null or v_a = v_b then
        raise exception 'swap_days needs two different days of this plan' using errcode = '22023';
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
      if v_count >= 200 then
        raise exception 'day % already holds 200 stops', v_day_no using errcode = '22023';
      end if;
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
      if v_count >= 200 then
        raise exception 'day % already holds 200 stops', v_day_no using errcode = '22023';
      end if;
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

-- create or replace keeps the grants of the first version (authenticated and
-- service_role only); stated again so this file stands on its own.
revoke execute on function public.apply_plan_changes(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_plan_changes(uuid, uuid, jsonb) to authenticated, service_role;
