---
title: assistant_conversations, assistant_messages, assistant_spend, assistant_tool_runs
type: table
domain: backend
version: 2.0.0
last_updated: 23.11.2026
status: draft
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
  - supabase/migrations/20261123123953_assistant_conversations.sql
  - supabase/migrations/20261123143607_assistant_turns_and_tool_runs.sql
related:
  - "[[_README]]"
  - "[[api_usage]]"
  - "[[../rls-policies]]"
  - "[[../../_plans/phase-2-assistant]]"
---

# `assistant_conversations`, `assistant_messages`, `assistant_spend`, `assistant_tool_runs`

The platform's own Claude agent keeps its conversations here ([[../../_plans/phase-2-assistant]]). Created on 23.11.2026 in two migrations: `assistant_conversations` (version 20261123123953) and `assistant_turns_and_tool_runs` (version 20261123143607 — server-only writes, the turn lease, tool runs). Only the agent core writes them, with the service role (`supabaseConversationStore`, `src/lib/agent/store.ts`); no route uses the core yet.

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
| `turn_lease_until` | timestamptz | yes | — | The turn lease: while it is in the future, a turn of this conversation is running and another one is refused. Set by the server before a turn, cleared after; a crashed turn's lease runs out (15 minutes, longer than a route can run). |

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

## `assistant_tool_runs`

One row per tool call the model makes — the decision, written **before** the call runs, then the result. A second request answering the same call can't record it again (primary key) and stops; a result that never reached the conversation is read from here instead of running the tool twice; a row left `running` was interrupted (the model is told the outcome is unknown).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | — | FK → `assistant_conversations.id`, ON DELETE CASCADE. |
| `tool_use_id` | text | no | — | The API's id of the call (`toolu_…`). PK with `conversation_id`. |
| `name` | text | no | — | The tool. |
| `decision` | text | no | — | CHECK `auto` (a read, no card) \| `approved` \| `declined` (on the card) \| `not_run` (the user wrote instead, the step limit, a cut-off call) \| `invalid` (the input failed the tool's schema). |
| `status` | text | no | `'running'` | CHECK `running` \| `done`. |
| `result` | text | yes | — | What the model read back. |
| `is_error` | boolean | yes | — | — |
| `created_at` | timestamptz | no | `now()` | When it was claimed. |
| `finished_at` | timestamptz | yes | — | — |

CHECK `assistant_tool_runs_done_has_result`: `done` ⇔ `result`, `is_error` and `finished_at` are set.

## RLS policies

| Table | Policy | CMD | Role | Predicate |
|---|---|---|---|---|
| `assistant_conversations` | Users read own assistant conversations | SELECT | authenticated | `auth.uid() = user_id` |
| `assistant_conversations` | Users delete own assistant conversations | DELETE | authenticated | `auth.uid() = user_id` |
| `assistant_messages` | Users read own assistant messages | SELECT | authenticated | the conversation is the user's |
| `assistant_spend` | Users read own assistant spend | SELECT | authenticated | `auth.uid() = user_id` |
| `assistant_tool_runs` | Users read own assistant tool runs | SELECT | authenticated | the conversation is the user's |

Users read their own rows and can delete a conversation (its messages and tool runs go with it); nothing else. **Only the server writes** — conversations, messages, tool runs, the lease and spend, with the service role; until 20261123143607 a user could insert a conversation (any system prompt and tools) or a message, and the server would have run it on the platform's key and budget. No UPDATE policy anywhere: a conversation's model, prompt and tools can't change, nor can a message.

## Trigger

`assistant_message_touches_conversation` — AFTER INSERT on `assistant_messages`, sets the conversation's `updated_at = now()`. The function (`assistant_message_touches_conversation()`) is SECURITY DEFINER with an empty `search_path`; `EXECUTE` revoked from `public`, `anon`, `authenticated`.

## Checked

Before applying, in a rolled-back transaction on the live database as the signed-in owner, another user and the service role: the owner starts a conversation and appends; starting one for another user, a `door` other than `app`, editing a conversation or a message, deleting a message, a user writing spend → refused or 0 rows; a duplicate `seq` → refused; another user sees and appends nothing; the service role writes spend and the owner reads it; deleting a conversation removes its messages and keeps its spend rows with `conversation_id` null; a message bumps `updated_at`. After applying (23.11.2026): RLS on for all three, six policies, one trigger, the function's `EXECUTE` limited to `postgres` and `service_role`.

## Checked — the second migration

Before applying, in a rolled-back transaction on the live database, and again after applying it (23.11.2026): the owner can't start a conversation, append a message, write or change a tool run, or set the lease (42501 / 0 rows); the service role writes all of it; the lease is taken once, refused while held and taken again after it runs out; a second claim of the same call is refused (23505); a `done` run without a result and an unknown decision are refused (23514); another user sees nothing; deleting a conversation removes its runs. After applying: 5 policies on the four tables, RLS on for all four. The store's own queries were then run against the live database without writing anything (`npm run check:agent:db`, 10 checks): every query is accepted, inserts are refused only by the foreign key, no row was written.
