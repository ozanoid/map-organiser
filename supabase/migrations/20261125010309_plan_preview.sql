-- Phase 2, step 4 (decision 6.1: AI Plan goes to the assistant;
-- docs/_plans/phase-2-assistant.md). The approval card of a plan change
-- shows the plan as it will be, and the change is saved only if that is
-- still what it will be when the user says yes.
--
-- preview_plan_changes runs the real write (apply_plan_changes) inside a
-- block that always ends in an exception, so every change it made is rolled
-- back, and returns the plan before and after. There is no second copy of
-- the plan rules: what the card shows is what the save would do. Nothing
-- persists. Errors of the change itself (an unknown stop, a day number out
-- of range, two days left with one number) are not caught: the caller learns
-- the change can't be applied, as the save would.
--
-- plan_snapshot is one plan as one JSON value — days in order, stops in
-- order with their place's name — shared by both reads.
--
-- New functions only; nothing that runs today changes.

create or replace function public.plan_snapshot(p_user_id uuid, p_plan_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'start_date', p.start_date,
    'party_size', p.party_size,
    'notes', p.notes,
    'status', p.status,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'day_number', d.day_number,
        'notes', d.notes,
        'stops', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'place_id', s.place_id,
            'name', coalesce(pl.name, s.title),
            'start_time', s.start_time,
            'day_part', s.day_part,
            'notes', s.notes,
            'status', s.status,
            'cost_estimate', s.cost_estimate,
            'currency', s.currency
          ) order by s.sort_order, s.created_at, s.id)
          from plan_stops s
          left join places pl on pl.id = s.place_id
          where s.day_id = d.id
        ), '[]'::jsonb)
      ) order by d.day_number)
      from plan_days d
      where d.plan_id = p.id
    ), '[]'::jsonb)
  )
  from plans p
  where p.id = p_plan_id and p.user_id = p_user_id;
$$;

create or replace function public.preview_plan_changes(
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
  v_before jsonb;
  v_after  jsonb;
begin
  perform plan_assert_caller(p_user_id);
  v_before := plan_snapshot(p_user_id, p_plan_id);
  if v_before is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  -- The block's work is undone by the exception it ends with; the variables
  -- keep what was read.
  begin
    perform apply_plan_changes(p_user_id, p_plan_id, p_changes);
    -- The save checks unique day numbers at commit; check them here.
    set constraints public.plan_days_plan_day_key immediate;
    v_after := plan_snapshot(p_user_id, p_plan_id);
    raise exception 'plan preview rolled back' using errcode = 'P0PRV';
  exception
    when sqlstate 'P0PRV' then
      null;
  end;

  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

revoke execute on function public.plan_snapshot(uuid, uuid) from public, anon;
revoke execute on function public.preview_plan_changes(uuid, uuid, jsonb) from public, anon;
grant execute on function public.plan_snapshot(uuid, uuid) to authenticated, service_role;
grant execute on function public.preview_plan_changes(uuid, uuid, jsonb) to authenticated, service_role;
