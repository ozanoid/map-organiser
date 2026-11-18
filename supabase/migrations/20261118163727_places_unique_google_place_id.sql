-- One place per Google place id per user. Every writer already checks first;
-- this makes the check hold when two adds run at once.
-- Measured 18.11.2026: no user has two places with the same google_place_id.
create unique index places_user_google_place_id_key
  on public.places (user_id, google_place_id)
  where google_place_id is not null;

-- Same columns, now covered by the unique index above.
drop index public.idx_places_google_id;
