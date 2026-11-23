---
title: assistant_conversations, assistant_messages, assistant_spend
type: table
domain: backend
version: 1.1.0
last_updated: 23.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261123123953_assistant_conversations.sql
  - supabase/migrations/20261123140000_assistant_turns_and_tool_runs.sql
related:
  - "[[_README]]"
  - "[[api_usage]]"
  - "[[../rls-policies]]"
  - "[[../../_plans/phase-2-assistant]]"
---

# `assistant_conversations`, `assistant_messages`, `assistant_spend`

The platform's own Claude agent keeps its conversations here ([[../../_plans/phase-2-assistant]]). Created on 23.11.2026 (`assistant_conversations`, version 20261123123953). No code reads or writes them yet; the agent core and the in-app door come next.

## Why the history lives on the server and never changes

Claude's 5.5 models always think, and each thinking block is bound to the exact conversation before it: the system prompt, the tools and every earlier message. When the conversation is sent back, the API checks that binding; if an earlier turn was trimmed, rewritten or lost a field on the way through the browser, the reasoning from that point is dropped or the request is refused. So a conversation's model, system prompt and tools are fixed when it starts, and its messages are only ever appended — stored as the exact JSON text sent to or received from the API.

## `assistant_conversations`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `door` | text | no | — | CHECK `app`. Where the conversation happens; a new door (Telegram, e-mail) is a migration. |
| `model` | text | no | — | The model the conversation started with; it never changes (thinking blocks are bound to it). |
| `system_prompt` | text | no | — | The system prompt as first sent. |
| `tools` | text | no | — | The tools array as first sent, as JSON text. |
| `created_at` | timestamptz | no | `now()` | — |
| `updated_at` | timestamptz | no | `now()` | Bumped by the trigger below when a message is appended. |

Index: `assistant_conversations_latest_idx (user_id, door, updated_at desc)` — "the user's latest conversation in this door".

## `assistant_messages`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | — | FK → `assistant_conversations.id`, ON DELETE CASCADE. |
| `seq` | integer | no | — | CHECK ≥ 0. Position in the conversation. |
| `role` | text | no | — | CHECK `user` \| `assistant`. |
| `content` | text | no | — | The message's content blocks as JSON text, exactly as sent or received (thinking blocks with their signatures). `text`, not `jsonb`: `jsonb` reorders keys. |
| `created_at` | timestamptz | no | `now()` | — |

Primary key `(conversation_id, seq)`: two requests appending to the same conversation at once can't both take the next number — the second insert fails instead of interleaving.

## `assistant_spend`

One row per Claude API call. The dollar amount is computed with the price at the time and stored, so a later price change doesn't rewrite history. The monthly cap ($100, platform-wide) is the sum of this table.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | no | identity | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id`, ON DELETE CASCADE. |
| `conversation_id` | uuid | yes | — | FK → `assistant_conversations.id`, ON DELETE SET NULL — deleting a conversation keeps what it cost. |
| `purpose` | text | no | — | CHECK `chat` \| `eval`. |
| `model` | text | no | — | The model that served the call. |
| `request_id` | text | yes | — | The API's request id, for support. |
| `input_tokens`, `output_tokens`, `cache_write_tokens`, `cache_read_tokens` | integer | no | `0` | CHECK ≥ 0. |
| `web_searches` | integer | no | `0` | CHECK ≥ 0. |
| `cost_usd` | numeric(12,6) | no | — | CHECK ≥ 0. |
| `created_at` | timestamptz | no | `now()` | — |

Index: `assistant_spend_created_idx (created_at)` — the month's total.

## RLS policies

| Table | Policy | CMD | Role | Predicate |
|---|---|---|---|---|
| `assistant_conversations` | Users read own assistant conversations | SELECT | authenticated | `auth.uid() = user_id` |
| `assistant_conversations` | Users start own assistant conversations | INSERT | authenticated | (with check) `auth.uid() = user_id` |
| `assistant_conversations` | Users delete own assistant conversations | DELETE | authenticated | `auth.uid() = user_id` |
| `assistant_messages` | Users read own assistant messages | SELECT | authenticated | the conversation is the user's |
| `assistant_messages` | Users append own assistant messages | INSERT | authenticated | (with check) the conversation is the user's |
| `assistant_spend` | Users read own assistant spend | SELECT | authenticated | `auth.uid() = user_id` |

No UPDATE policy anywhere: a conversation's model, prompt and tools can't change, nor can a message. Messages can't be deleted one by one — only with their conversation. Spend rows are written by the server (service role) only.

## Trigger

`assistant_message_touches_conversation` — AFTER INSERT on `assistant_messages`, sets the conversation's `updated_at = now()`. The function (`assistant_message_touches_conversation()`) is SECURITY DEFINER with an empty `search_path`; `EXECUTE` revoked from `public`, `anon`, `authenticated`.

## Checked

Before applying, in a rolled-back transaction on the live database as the signed-in owner, another user and the service role: the owner starts a conversation and appends; starting one for another user, a `door` other than `app`, editing a conversation or a message, deleting a message, a user writing spend → refused or 0 rows; a duplicate `seq` → refused; another user sees and appends nothing; the service role writes spend and the owner reads it; deleting a conversation removes its messages and keeps its spend rows with `conversation_id` null; a message bumps `updated_at`. After applying (23.11.2026): RLS on for all three, six policies, one trigger, the function's `EXECUTE` limited to `postgres` and `service_role`.

## Next migration — prepared, not applied

`supabase/migrations/20261123140000_assistant_turns_and_tool_runs.sql` (23.11.2026, waiting for Ozan's approval; the file is renamed to the recorded version when applied):

- drops the two user INSERT policies — only the server (service role) writes conversations and messages. Today a signed-in user could insert a conversation with any system prompt and tools, or an assistant message, and the server would run it on the platform's key and budget;
- `assistant_conversations.turn_lease_until timestamptz` — one turn at a time per conversation;
- `assistant_tool_runs (conversation_id, tool_use_id, name, decision, status, result, is_error, created_at, finished_at)`, PK `(conversation_id, tool_use_id)`, ON DELETE CASCADE; `decision` CHECK `auto | approved | declined | not_run | invalid`, `status` CHECK `running | done`, and `done` ⇔ result, `is_error` and `finished_at` are set. RLS: the owner reads; only the server writes.

Checked in a rolled-back transaction on the live database (23.11.2026): the owner can't start a conversation, append a message, write or change a tool run, or set the lease; the service role writes all of it; the lease is taken once, refused while held and taken again after it runs out; a second claim of the same call is refused (23505); a `done` run without a result and an unknown decision are refused (23514); another user sees nothing; deleting a conversation removes its runs. Nothing persisted.

