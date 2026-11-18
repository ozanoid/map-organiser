-- save_list, revised after the slice-4 review (18.11.2026):
-- - add_place on a place already on the list replaces its note only with a
--   note that has words in it; an empty or null note keeps the old one.
--   Before, a caller that sent `note: null` for "make sure it's on the list"
--   wiped the note. Clearing a note is set_note's job.
-- - Names, descriptions and notes are trimmed of tabs and line breaks too,
--   not only spaces: a note of "\n" is no note.
-- Revised under the standing permission for the list write function
-- (supabase/migrations/README.md). The rest is as in …044153_list_functions.sql.
create or replace function public.save_list(p_user_id uuid, p_list jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_list_id  uuid := nullif(p_list->>'list_id', '')::uuid;
  v_set      jsonb := coalesce(p_list->'set', '{}'::jsonb);
  v_ops      jsonb := coalesce(p_list->'ops', '[]'::jsonb);
  v_via      text := coalesce(nullif(p_list->>'created_via', ''), 'app');
  v_created  boolean := false;
  v_op       jsonb;
  v_kind     text;
  v_place    uuid;
  v_note     text;
  v_pos      integer;
  v_old      integer;
  v_count    integer;
  v_ids      uuid[];
  v_name     text;
  v_desc     text;
  v_added    uuid[] := '{}';
  v_already  uuid[] := '{}';
  v_removed  uuid[] := '{}';
  v_absent   uuid[] := '{}';
begin
  perform plan_assert_caller(p_user_id);

  if jsonb_typeof(v_set) <> 'object' then
    raise exception 'set must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(v_ops) <> 'array' then
    raise exception 'ops must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_ops) > 1000 then
    raise exception 'at most 1000 changes at once' using errcode = '22023';
  end if;

  -- The list's own fields, checked once for a new list and a change.
  if v_set ? 'name' then
    v_name := btrim(coalesce(v_set->>'name', ''), E' \t\r\n');
    if v_name = '' or char_length(v_name) > 120 then
      raise exception 'a list name is 1 to 120 characters' using errcode = '22023';
    end if;
  end if;
  if v_set ? 'description' then
    v_desc := nullif(btrim(coalesce(v_set->>'description', ''), E' \t\r\n'), '');
    if char_length(v_desc) > 2000 then
      raise exception 'a list description is at most 2000 characters' using errcode = '22023';
    end if;
  end if;
  if v_set ? 'color' and char_length(coalesce(v_set->>'color', '')) not between 1 and 20 then
    raise exception 'a colour is 1 to 20 characters' using errcode = '22023';
  end if;

  if v_list_id is null then
    if v_name is null then
      raise exception 'a new list needs a name' using errcode = '22023';
    end if;
    if v_via not in ('app', 'assistant') then
      raise exception 'created_via is app or assistant' using errcode = '22023';
    end if;
    insert into lists (user_id, name, description, color, created_via)
    values (p_user_id, v_name, v_desc, coalesce(nullif(v_set->>'color', ''), '#059669'), v_via)
    returning id into v_list_id;
    v_created := true;
  else
    -- Locked for the rest of the transaction: two saves to one list queue.
    perform 1 from lists where id = v_list_id and user_id = p_user_id for update;
    if not found then
      raise exception 'list not found' using errcode = 'P0002';
    end if;
    update lists set
      name        = case when v_set ? 'name' then v_name else name end,
      description = case when v_set ? 'description' then v_desc else description end,
      color       = case when v_set ? 'color' then v_set->>'color' else color end
    where id = v_list_id;

    with ranked as (
      select place_id,
             (row_number() over (order by sort_order, added_at nulls last, place_id) - 1)::int as pos
      from list_places
      where list_id = v_list_id
    )
    update list_places lp
    set sort_order = r.pos
    from ranked r
    where lp.list_id = v_list_id and lp.place_id = r.place_id and lp.sort_order <> r.pos;
  end if;

  for v_op in select value from jsonb_array_elements(v_ops) loop
    v_kind  := v_op->>'op';
    v_place := nullif(v_op->>'place_id', '')::uuid;
    v_note  := null;
    if v_kind in ('add_place', 'remove_place', 'set_note', 'move_place') and v_place is null then
      raise exception '% needs place_id', v_kind using errcode = '22023';
    end if;
    if v_op ? 'note' then
      v_note := nullif(btrim(coalesce(v_op->>'note', ''), E' \t\r\n'), '');
      if char_length(v_note) > 2000 then
        raise exception 'a note is at most 2000 characters' using errcode = '22023';
      end if;
    end if;

    if v_kind = 'add_place' then
      perform 1 from places where id = v_place and user_id = p_user_id;
      if not found then
        raise exception 'place % is not one of this user''s places', v_place using errcode = '22023';
      end if;
      if exists (select 1 from list_places where list_id = v_list_id and place_id = v_place) then
        -- Only a note with words in it replaces the one there: an empty or
        -- null note on add_place keeps it (clearing is set_note's job).
        if v_note is not null then
          update list_places set note = v_note where list_id = v_list_id and place_id = v_place;
        end if;
        v_already := v_already || v_place;
      else
        select count(*) into v_count from list_places where list_id = v_list_id;
        if v_count >= 1000 then
          raise exception 'a list holds up to 1000 places' using errcode = '22023';
        end if;
        v_pos := least(greatest(coalesce((v_op->>'position')::integer, v_count), 0), v_count);
        update list_places set sort_order = sort_order + 1
        where list_id = v_list_id and sort_order >= v_pos;
        insert into list_places (list_id, place_id, sort_order, note)
        values (v_list_id, v_place, v_pos, v_note);
        v_added := v_added || v_place;
      end if;

    elsif v_kind = 'remove_place' then
      delete from list_places where list_id = v_list_id and place_id = v_place
      returning sort_order into v_old;
      if found then
        update list_places set sort_order = sort_order - 1
        where list_id = v_list_id and sort_order > v_old;
        v_removed := v_removed || v_place;
      else
        v_absent := v_absent || v_place;
      end if;

    elsif v_kind = 'set_note' then
      if not (v_op ? 'note') then
        raise exception 'set_note needs note (null clears it)' using errcode = '22023';
      end if;
      update list_places set note = v_note where list_id = v_list_id and place_id = v_place;
      if not found then
        raise exception 'place % is not on this list', v_place using errcode = '22023';
      end if;

    elsif v_kind = 'move_place' then
      select sort_order into v_old from list_places where list_id = v_list_id and place_id = v_place;
      if not found then
        raise exception 'place % is not on this list', v_place using errcode = '22023';
      end if;
      select count(*) into v_count from list_places where list_id = v_list_id;
      v_pos := least(greatest(coalesce((v_op->>'position')::integer, v_count - 1), 0), v_count - 1);
      if v_pos > v_old then
        update list_places set sort_order = sort_order - 1
        where list_id = v_list_id and sort_order > v_old and sort_order <= v_pos;
      elsif v_pos < v_old then
        update list_places set sort_order = sort_order + 1
        where list_id = v_list_id and sort_order >= v_pos and sort_order < v_old;
      end if;
      update list_places set sort_order = v_pos where list_id = v_list_id and place_id = v_place;

    elsif v_kind = 'reorder' then
      if jsonb_typeof(v_op->'place_ids') is distinct from 'array' then
        raise exception 'reorder needs place_ids' using errcode = '22023';
      end if;
      v_ids := array(select (jsonb_array_elements_text(v_op->'place_ids'))::uuid);
      select count(*) into v_count from list_places where list_id = v_list_id;
      if cardinality(v_ids) <> v_count
         or (select count(distinct x) from unnest(v_ids) as x) <> v_count
         or exists (select 1 from list_places where list_id = v_list_id and not (place_id = any (v_ids))) then
        raise exception 'reorder names every place of the list once' using errcode = '22023';
      end if;
      update list_places lp
      set sort_order = (t.ord - 1)::int
      from unnest(v_ids) with ordinality as t(id, ord)
      where lp.list_id = v_list_id and lp.place_id = t.id;

    else
      raise exception 'unknown op %', coalesce(v_kind, '(none)') using errcode = '22023';
    end if;
  end loop;

  update lists set updated_at = now() where id = v_list_id;

  return jsonb_build_object(
    'list_id', v_list_id,
    'created', v_created,
    'added', to_jsonb(v_added),
    'already', to_jsonb(v_already),
    'removed', to_jsonb(v_removed),
    'absent', to_jsonb(v_absent)
  );
end
$$;

-- Only signed-in users and the service role call it.
revoke execute on function public.save_list(uuid, jsonb) from public, anon;
