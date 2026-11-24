-- Phase 2, decision 6.4: one ledger and one monthly cap for every Claude call
-- (docs/_plans/phase-2-assistant.md). Place profiles (Claude Sonnet 5.5) and
-- Instagram post reads (Claude Haiku 5.5) are written to assistant_spend from
-- now on, each under its own purpose, next to the assistant's turns and the
-- paid evals.
--
-- Widening only: every existing row ('chat', 'eval') still passes. Written by
-- the server only (service role), as before.

alter table public.assistant_spend
  drop constraint assistant_spend_purpose_check,
  add constraint assistant_spend_purpose_check
    check (purpose in ('chat', 'eval', 'profile', 'instagram'));
