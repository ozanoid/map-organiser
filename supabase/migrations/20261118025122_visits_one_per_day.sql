-- One visit per place per day (Ozan, 18.11.2026).
--
-- "I went to X on Saturday" said twice — the assistant retrying a call, or
-- the same evening logged from the plan and again from the place page — is
-- one visit, not two. log_visit updates the existing row instead of adding a
-- second one; this index is what makes that hold under any caller. The table
-- was empty when the index was added.
create unique index visits_place_day_key on public.visits (user_id, place_id, visited_on);
