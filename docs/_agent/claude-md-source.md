---
title: CLAUDE.md Source
type: agent-note
domain: agent
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[conventions]]"
  - "[[common-tasks]]"
  - "[[pitfalls]]"
---

# CLAUDE.md Source

Canonical content for the repo's `CLAUDE.md` (loaded automatically at the start of every Claude Code session in this repo). Treat this doc as the source-of-truth; whenever this changes, regenerate `CLAUDE.md` to match.

The on-disk `CLAUDE.md` should be terse — the goal is to get the agent to the right vault doc fast, not to repeat the vault content inline.

## Current `CLAUDE.md` (live)

```
@AGENTS.md
```

That's all. It pulls in `AGENTS.md`, which warns about Next.js 16 being different from training data.

## Proposed `CLAUDE.md` (apply when ready)

```
@AGENTS.md

# How to work in this repo

Before any non-trivial change, read:

1. `docs/_agent/conventions.md` — coding rules
2. `docs/_agent/pitfalls.md` — Next.js 16 / React 19 / Supabase SSR traps
3. The relevant checklist in `docs/_agent/common-tasks.md`

After any code change that touches files listed in a doc's `sources:`, update that doc per `docs/_meta/vault-guide.md` and log it in `docs/CHANGELOG.md`.

For documentation conventions, see `docs/_meta/vault-guide.md` and `docs/_meta/frontmatter-schema.md`.
```

## When to regenerate

The on-disk `CLAUDE.md` should be updated when:

- The recommended reading order changes.
- A new foundational doc is added that every session should know about.
- The vault root location changes (unlikely).

Don't update `CLAUDE.md` for content changes inside the docs themselves — the agent reads those docs on-demand.

## Why this indirection

Keeping `CLAUDE.md` thin avoids context bloat on every session start. The vault is opt-in, fetched only when the task requires it.
