@AGENTS.md

# How to work in this repo

Before any non-trivial change, read:

1. `docs/_agent/conventions.md` — coding rules
2. `docs/_agent/pitfalls.md` — Next.js 16 / React 19 / Supabase SSR traps
3. The relevant checklist in `docs/_agent/common-tasks.md`

After any code change that touches files listed in a doc's `sources:`, update that doc. The `.claude/hooks/post-edit-docs.sh` hook automatically lists affected docs on every Edit/Write. Use `/update-docs` to walk through them.

For documentation conventions: `docs/_meta/vault-guide.md` and `docs/_meta/frontmatter-schema.md`.

Vault entry point: `docs/README.md`.
