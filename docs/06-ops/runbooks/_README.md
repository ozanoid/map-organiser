---
title: Runbooks
type: overview
domain: ops
version: 1.1.0
last_updated: 19.05.2026
status: stable
related:
  - "[[../_README]]"
---

# Runbooks

Step-by-step procedures for repeatable ops tasks. Each runbook has:

- **Preconditions** — what must be true before starting.
- **Steps** — ordered, copy-paste-able where possible.
- **Verification** — how to confirm it worked.
- **Rollback** — what to do if it didn't.

## Index

| Runbook | When to run |
|---|---|
| [[dedupe-categories]] | A user has ≥ 2 categories with the same name (e.g. trigger regression seeded defaults twice) |

## Candidates (worth writing when needed)

- **rotate-encryption-secret** — rotate `ENCRYPTION_SECRET` and re-encrypt all `*_enc` columns. See [[../encryption#key-rotation]].
- **regenerate-db-types** — generate `database.types.ts` from the live schema (if/when we wire `supabase gen types`).
- **account-deletion** — delete a user's `auth.users` row + cascade cleanup + verify no orphans.
- **restore-from-backup** — restore Supabase Pro automated backup.
- **photo-storage-cleanup** — delete orphaned `place-photos` Storage objects whose `places` row no longer exists.
- **share-link-orphan-cleanup** — DELETE `shared_links` rows whose `resource_id` no longer references an existing list/trip.
- **reset-default-categories** — re-seed the 12 default categories for a user who deleted some.
- **lock-down-security-definer-functions** — apply the REVOKE EXECUTE statements from [[../../02-backend/rls-policies#recommended-hardening-not-yet-applied]].

## When to add a runbook

If you perform a procedure twice, write the runbook on the second time. If it's risky or rare (rotations, deletions, restores), write it before the first time.

## Template

Use the [[../../_meta/templates/runbook|runbook template]]: copy, rename to `<short-name>.md`, fill in. Update this index.
