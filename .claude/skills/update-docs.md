---
name: update-docs
description: Update vault docs after a code change. Invoke when the post-edit-docs hook flags affected docs, or when the user explicitly asks. Takes one optional argument — a doc path or a source path. With no argument, walk through every doc whose `sources:` was touched in the current branch and offer to update it.
---

# `/update-docs` — vault doc update workflow

Use this skill to keep the Obsidian docs vault in `docs/` in sync with code changes.

## When to invoke

- The PostToolUse hook (`.claude/hooks/post-edit-docs.sh`) printed a list of docs after an Edit/Write.
- The user asks "update the docs" / "sync the docs" / "the docs are stale".
- Before opening a PR.

## Inputs

- Optional argument: a path to either a doc (`docs/01-domain/places.md`) or a source file (`src/lib/types/index.ts`).
- If no argument: figure out which source files changed on the current branch and gather affected docs.

## Procedure

1. **Identify affected docs.**
   - If arg is a doc path → that's the target.
   - If arg is a source path → `rg -l "^[[:space:]]*-[[:space:]]+<path>\$" docs/`
   - If no arg → list source files changed on this branch (`git diff --name-only main...HEAD`), then for each, run the same rg search and union the results.

2. **Per doc, propose updates.**
   - Read the doc.
   - Compare its claims to the current state of the source files it lists.
   - If columns / methods / props changed: update the relevant section.
   - If a file moved or was deleted: update `sources:` (or remove the doc if no longer relevant).
   - If logic changed: update the prose.

3. **Bump frontmatter on every change.**
   - `version`: bump per the [Versioning section in frontmatter-schema](../../docs/_meta/frontmatter-schema.md#versioning). MAJOR for restructure, MINOR for new section, PATCH for typo/link/small correction.
   - `last_updated`: today's date in `DD.MM.YYYY`.
   - `status`: leave alone unless promoting (`draft → stable`) or retiring (`stable → deprecated`).

4. **Update [docs/CHANGELOG.md](../../docs/CHANGELOG.md).**
   - Newest-first entry under today's date.
   - Format: `## DD.MM.YYYY — vX.Y.Z — short title` followed by bullets per doc touched.

5. **Stop and ask** if the change is structural (renaming a doc, deleting sections, restructuring folders). Don't do that silently.

## Don't

- Don't update docs based on guessed code state — re-read the source files.
- Don't add new `sources:` entries unless you've verified the path exists.
- Don't bump `version` to MAJOR without flagging it to the user.
- Don't touch files in `docs/_archive/` unless the user explicitly asks.

## Conventions

Authority for everything above:

- [docs/_meta/vault-guide.md](../../docs/_meta/vault-guide.md) — vault structure + per-doc workflow.
- [docs/_meta/frontmatter-schema.md](../../docs/_meta/frontmatter-schema.md) — fields, enums, versioning.
- [docs/_agent/conventions.md](../../docs/_agent/conventions.md) — coding rules cross-referenced by the docs.
- [docs/_agent/common-tasks.md](../../docs/_agent/common-tasks.md) — recipes for "add a route", "add a table", etc., each ending with a doc-update step.
