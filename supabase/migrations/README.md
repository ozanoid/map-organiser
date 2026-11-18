# Database migrations

SQL for every schema change since 18.11.2026. Each file is applied to the
Supabase project under the same name (Supabase records it in
`supabase_migrations.schema_migrations`); after applying, the file's
timestamp prefix is set to the version Supabase recorded, so this folder and
the database history line up.

The 56 migrations applied before that date exist only in the database
(`select version, name from supabase_migrations.schema_migrations`); their SQL
was not kept in the repo.

Rules:

- One concern per file; say why in a comment at the top.
- Show the SQL to Ozan before applying it.
- Prefer expand → cutover → contract for anything the running code depends
  on: add the new structure first, switch the code, drop the old structure
  last.
