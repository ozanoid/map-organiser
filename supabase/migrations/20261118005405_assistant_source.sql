-- Places added through an assistant tool (add_place) get their own source
-- and their own import-job kind, so they can be told apart from manual adds,
-- Takeout imports and Instagram imports. Both checks are only widened.

alter table public.places drop constraint places_source_check;
alter table public.places add constraint places_source_check
  check (source = any (array[
    'manual', 'import', 'link', 'mapbox_search', 'similar', 'shared', 'instagram', 'assistant'
  ]));

alter table public.import_jobs drop constraint import_jobs_kind_check;
alter table public.import_jobs add constraint import_jobs_kind_check
  check (kind = any (array['takeout', 'instagram', 'assistant']));
