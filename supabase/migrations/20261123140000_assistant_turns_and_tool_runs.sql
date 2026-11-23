-- The Claude agent's tables, second step (docs/_plans/phase-2-assistant.md).
--
-- 1. Only the server writes conversations and messages (service role).
--    Until now a signed-in user could insert a conversation with any system
--    prompt and tools, or an assistant message, and the server would run it
--    on the platform's API key and budget. Users keep reading their own and
--    deleting a conversation.
-- 2. One turn at a time per conversation: a lease the server takes before a
--    turn and clears after. A turn cut off by a crash frees it when it runs
--    out — longer than the 800 s a route can run.
-- 3. Tool runs: one row per tool call the model makes, with the decision and
--    then the result, written before the call runs. A second request answering
--    the same call can't claim it (primary key); a result that never reached
--    the conversation is read from here instead of running the tool twice; a
--    run left 'running' was interrupted.

drop policy "Users start own assistant conversations" on public.assistant_conversations;
drop policy "Users append own assistant messages" on public.assistant_messages;

alter table public.assistant_conversations add column turn_lease_until timestamptz;

create table public.assistant_tool_runs (
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  tool_use_id     text not null,
  name            text not null,
  decision        text not null check (decision in ('auto', 'approved', 'declined', 'not_run', 'invalid')),
  status          text not null default 'running' check (status in ('running', 'done')),
  result          text,
  is_error        boolean,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  primary key (conversation_id, tool_use_id),
  constraint assistant_tool_runs_done_has_result check (
    (status = 'done') = (result is not null and is_error is not null and finished_at is not null)
  )
);

alter table public.assistant_tool_runs enable row level security;

create policy "Users read own assistant tool runs" on public.assistant_tool_runs
  for select to authenticated
  using (
    conversation_id in (
      select c.id from public.assistant_conversations c where c.user_id = (select auth.uid())
    )
  );
