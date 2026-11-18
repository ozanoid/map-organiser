@AGENTS.md

# How to work in this repo

Before any non-trivial change, read:

1. `docs/_agent/conventions.md` — coding rules
2. `docs/_agent/pitfalls.md` — Next.js 16 / React 19 / Supabase SSR traps
3. The relevant checklist in `docs/_agent/common-tasks.md`

After any code change that touches files listed in a doc's `sources:`, update that doc. The `.claude/hooks/post-edit-docs.sh` hook automatically lists affected docs on every Edit/Write. Use `/update-docs` to walk through them.

For documentation conventions: `docs/_meta/vault-guide.md` and `docs/_meta/frontmatter-schema.md`.

Vault entry point: `docs/README.md`. The current direction and its phases: `docs/_plans/personal-assistant.md`.

# How to design changes

Design for the long run, not for what is cheapest today.

- **Model first, existing code second.** Derive the right structure from the scenarios as if nothing existed, then compare it with the current code and give the migration path. Don't choose an option because existing tables, screens or code make it cheap, and say which parts of a proposal are patches.
- **Get the structure right up front:** entities and their relationships, one source of truth per fact, atomic write paths, names that match the domain. Record now what can't be reconstructed later (who created it, when it happened). Purely additive fields can wait until they are needed.
- **A proposal carries** the model, the gaps of the current structure with evidence (file:line, live schema, measured data), the migration path with a regression list, and what was considered and rejected.
- **Schema changes:** the SQL lives in `supabase/migrations/`, is shown to Ozan before it is applied, and prefers expand → cutover → contract over changing a structure the running code depends on.
- **Costs:** give the unit, the free allowance and the measured usage — never a bare price.
