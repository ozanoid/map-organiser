-- Phase 2 (personal-assistant plan; design: docs/_plans/phase-2-assistant.md):
-- the platform's own Claude agent keeps its conversations on the server.
--
-- Why: on Claude's 5.5 models every thinking block is bound to the exact
-- conversation before it — the system prompt, the tool set and every earlier
-- message. A history the browser sends back (trimmed, re-rendered, passed
-- through the app's own message types) breaks that binding, and the API
-- drops the reasoning or rejects the request. So the one copy of the history
-- lives here, append-only, exactly as it was sent and received; the browser
-- sends only the new message.
--
-- Three tables:
--   assistant_conversations — one conversation through one door (today only
--     'app'). Model, system prompt and tool definitions are fixed when it
--     starts and never change: a later deploy doesn't edit an old conversation.
--   assistant_messages — its turns in order. Content is the JSON array of
--     content blocks as text, not jsonb: jsonb reorders object keys, which
--     could make the history read as changed when it is sent back. No update
--     or delete — only the whole conversation can be deleted.
--   assistant_spend — one row per Claude API call: tokens by kind, web
--     searches, and the dollar cost at that call's prices (prices change, so
--     the amount is kept). The monthly $100 cap is this table's sum.

create table public.assistant_conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  door          text not null check (door in ('app')),
  model         text not null,
  system_prompt text not null,
  tools         text not null,          -- the tools array as first sent (JSON)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index assistant_conversations_latest_idx
  on public.assistant_conversations (user_id, door, updated_at desc);

create table public.assistant_messages (
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  seq             integer not null check (seq >= 0),
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,        -- JSON array of content blocks, as sent / received
  created_at      timestamptz not null default now(),
  primary key (conversation_id, seq)
);

create table public.assistant_spend (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  conversation_id    uuid references public.assistant_conversations (id) on delete set null,
  purpose            text not null check (purpose in ('chat', 'eval')),
  model              text not null,
  request_id         text,
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  web_searches       integer not null default 0 check (web_searches >= 0),
  cost_usd           numeric(12, 6) not null check (cost_usd >= 0),
  created_at         timestamptz not null default now()
);

create index assistant_spend_created_idx on public.assistant_spend (created_at);

-- ── A message keeps its conversation's updated_at current ─────────────
-- (the panel opens the most recent conversation). SECURITY DEFINER because
-- users have no UPDATE on conversations; EXECUTE is revoked like every
-- trigger function here — it is checked when the trigger is created, not
-- when it fires.
create function public.assistant_message_touches_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.assistant_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$function$;

revoke execute on function public.assistant_message_touches_conversation() from public, anon, authenticated;

create trigger assistant_message_touches_conversation
  after insert on public.assistant_messages
  for each row execute function public.assistant_message_touches_conversation();

-- ── Row level security ───────────────────────────────────────────────
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages      enable row level security;
alter table public.assistant_spend         enable row level security;

-- Conversations: the owner reads, starts and deletes them; no UPDATE, so the
-- model, prompt and tools stay as they started.
create policy "Users read own assistant conversations" on public.assistant_conversations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users start own assistant conversations" on public.assistant_conversations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users delete own assistant conversations" on public.assistant_conversations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Messages: read and append within one's own conversations; nothing edits
-- or removes a single message.
create policy "Users read own assistant messages" on public.assistant_messages
  for select to authenticated
  using (
    conversation_id in (
      select c.id from public.assistant_conversations c where c.user_id = (select auth.uid())
    )
  );

create policy "Users append own assistant messages" on public.assistant_messages
  for insert to authenticated
  with check (
    conversation_id in (
      select c.id from public.assistant_conversations c where c.user_id = (select auth.uid())
    )
  );

-- Spend: written only by the server (service role); the owner may read it.
create policy "Users read own assistant spend" on public.assistant_spend
  for select to authenticated
  using ((select auth.uid()) = user_id);
