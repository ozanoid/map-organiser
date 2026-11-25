-- Phase 3, slice 1 follow-up: index notifications.plan_id.
--
-- notifications.plan_id references plans (ON DELETE SET NULL), but nothing
-- indexed it: deleting a plan made Postgres look for that plan's records by
-- reading the whole table. Supabase's performance advisor flagged it right
-- after 20261125203540_notifications.sql was applied (lint 0001,
-- unindexed_foreign_keys, 25.11.2026). Slice 3 reads a plan's records too
-- (answers to an invitation). The table is empty today, so the index is
-- built at once.
create index notifications_plan_idx on public.notifications (plan_id);
