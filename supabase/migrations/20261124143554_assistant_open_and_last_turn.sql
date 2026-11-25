-- The Claude agent's tables, third step (docs/_plans/phase-2-assistant.md):
-- two fixes from the review of the in-app door.
--
-- 1. The conversation a door shows is the one the user opened last — "New
--    chat" (or, later, picking an old one) — not the one written to last. A
--    turn still running in an older conversation appends messages and bumps
--    its updated_at; ordering by that pulled the panel back to it.
-- 2. The last turn's outcome, so a reload can say why a message has no
--    reply (declined by the safety checks, cut off, an error). The history
--    holds only what the model saw and can't carry it.
--
-- Written by the server only (service role); users read their own rows as
-- before. The table has no rows yet (23.11.2026), so no backfill.

alter table public.assistant_conversations
  add column opened_at timestamptz not null default now();

create index assistant_conversations_open_idx
  on public.assistant_conversations (user_id, door, opened_at desc);

-- Replaced by the index above; nothing orders by updated_at any more.
drop index public.assistant_conversations_latest_idx;

alter table public.assistant_conversations
  add column last_turn_status text
    check (last_turn_status in ('done', 'awaiting_approval', 'refused', 'max_tokens', 'step_limit', 'error')),
  add column last_turn_code text,
  add column last_turn_seq integer check (last_turn_seq >= 0),
  add column last_turn_at timestamptz,
  add constraint assistant_conversations_turn_code_only_on_error
    check (last_turn_code is null or last_turn_status = 'error');
