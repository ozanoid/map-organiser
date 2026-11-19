-- Security advisor pass (19.11.2026, v1.43.0): PostGIS's spatial_ref_sys is
-- writable through the API.
--
-- The table sits in `public` without RLS (advisor lint 0013), and its owner,
-- supabase_admin, granted INSERT, UPDATE, DELETE and TRUNCATE on it to `anon`
-- and `authenticated`. With the public anon key anyone could change or delete
-- the SRID definitions PostGIS reads — 4326 among them — and break every
-- geography query. Checked in a rolled-back transaction on the live database:
-- as `anon`, an UPDATE of srid 4326 changed 1 row.
--
-- The usual fixes are out of reach for the `postgres` role: it can't revoke
-- grants supabase_admin made (no grant option), can't enable RLS on a table it
-- doesn't own, and PostGIS can't be moved out of `public` (not relocatable —
-- only drop and recreate, under places.location). It does hold TRIGGER on the
-- table, so a trigger refuses writes from the two API roles; reads, PostGIS
-- itself, the service role and direct sessions are unaffected. Checked in the
-- same rolled-back transaction: anon INSERT / UPDATE / DELETE and
-- authenticated UPDATE → 42501; anon SELECT and a geography distance as
-- authenticated → ok; service_role and a direct session → ok.
--
-- (geometry_columns and geography_columns carry the same grants but are
-- views: a write as anon changed 0 rows or failed — nothing to guard.)

create function public.spatial_ref_sys_read_only()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'spatial_ref_sys is read-only through the API'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$function$;

revoke execute on function public.spatial_ref_sys_read_only() from public, anon, authenticated;

create trigger spatial_ref_sys_read_only
  before insert or update or delete on public.spatial_ref_sys
  for each row execute function public.spatial_ref_sys_read_only();

create trigger spatial_ref_sys_no_truncate
  before truncate on public.spatial_ref_sys
  for each statement execute function public.spatial_ref_sys_read_only();
