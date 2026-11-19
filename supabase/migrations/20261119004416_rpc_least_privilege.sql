-- Security advisor pass (19.11.2026, v1.43.0). Three SECURITY DEFINER
-- functions in `public` could be executed by `anon` and `authenticated`
-- through /rest/v1/rpc (Supabase advisor lints 0028 and 0029).
--
-- 1. increment_api_usage(p_user_id, p_sku, p_cost) wrote a usage row for any
--    user id, callable with the public anon key. The AI budget guard
--    (src/lib/ai/track-usage.ts) counts these rows, so anyone holding a user's
--    id could run that user's monthly AI caps out — and until v1.43.0 the
--    public shared-list payload carried the owner's id. Now: no `anon`; a
--    signed-in caller counts only their own usage; the service role (cron,
--    import queue, scripts) and direct database sessions are unchanged.
-- 2. create_default_categories() and handle_new_user() are trigger functions
--    that nothing calls over RPC. EXECUTE on a trigger function is checked
--    when the trigger is created, not when it fires.
--
-- Checked 19.11.2026 in a rolled-back transaction on the live database: an
-- insert as `authenticated` still fired a trigger whose function it could not
-- execute; `authenticated` counting its own usage → ok, another user's → 42501;
-- `anon` → 42501; `service_role` and a direct session → ok.
--
-- Apply only after the v1.43.0 code is deployed: until then the import
-- queue's review stage counted usage through a session-less cookie client,
-- that is as `anon`.

create or replace function public.increment_api_usage(p_user_id uuid, p_sku text, p_cost numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'authenticated' and p_user_id is distinct from auth.uid() then
    raise exception 'increment_api_usage: a user can only count their own usage'
      using errcode = '42501';
  end if;
  insert into public.api_usage (user_id, sku, count, cost_per_1k, created_at)
  values (p_user_id, p_sku, 1, p_cost, current_date)
  on conflict (user_id, sku, created_at)
  do update set count = api_usage.count + 1;
end;
$function$;

revoke execute on function public.increment_api_usage(uuid, text, numeric) from public, anon;
revoke execute on function public.create_default_categories() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
