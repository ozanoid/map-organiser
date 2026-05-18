---
title: ai_suggestions_queue
type: table
domain: backend
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - Supabase project hukppmaevcapvbrvxtph (live)
related:
  - "[[_README]]"
  - "[[subcategories]]"
  - "[[tags]]"
  - "[[../api-routes/places]]"
  - "[[../../05-flows/full-profile-flow]]"
tags:
  - ai
  - moderation
---

# `ai_suggestions_queue`

Moderation queue for AI-proposed tags and sub-categories that aren't in the
user's existing dictionary. Written by Phase 4's `step=profile` after the
LLM call; consumed by Phase 5's Settings → AI moderation UI.

Place profile generation auto-applies `matched_existing` tags/lists silently
(3-band policy) — the queue only catches **new proposals** that need user
review before they pollute the user's tag/sub-category vocabulary.

## Columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `user_id` | uuid | no | — | FK → `auth.users.id` ON DELETE CASCADE. |
| `place_id` | uuid | yes | — | FK → `places.id` ON DELETE CASCADE. The place that triggered the proposal. |
| `type` | text | no | — | CHECK: `'tag'`, `'subcategory'`, or `'category_change'` (Phase 5.5). |
| `proposed_value` | text | no | — | The lowercase-hyphenated slug/name the LLM proposed. |
| `parent_category_id` | uuid | yes | — | For subcategory proposals: which parent category. NULL for tag proposals. |
| `confidence` | numeric | no | — | LLM confidence 0..1 (CHECK `>= 0 AND <= 1`). |
| `status` | text | no | `'pending'` | CHECK: `'pending'` / `'accepted'` / `'rejected'`. |
| `resolved_at` | timestamptz | yes | — | Set when status leaves pending. |
| `source_model` | text | yes | — | e.g. `gemini-flash-latest`. For traceability when models change. |
| `created_at` | timestamptz | no | `now()` | — |

## Indexes

| Name | Columns | Type | Purpose |
|---|---|---|---|
| `ai_suggestions_queue_pkey` | `id` | btree UNIQUE | Primary key. |
| `idx_ai_suggestions_user_status` | `(user_id, status)` | btree | Settings UI pending count. |
| `idx_ai_suggestions_pending` | `(user_id, type)` WHERE `status = 'pending'` | btree partial | Moderation queue hot path, scoped per type. |
| `idx_ai_suggestions_unique_pending` | `(user_id, type, lower(proposed_value), COALESCE(parent_category_id, '00000000-…'))` WHERE `status = 'pending'` | btree UNIQUE partial | Dedupes same proposal across re-runs. INSERTs throw on collision — apply-suggestions catches silently. |

## RLS

| Policy | CMD | Role | Predicate |
|---|---|---|---|
| Users manage own AI suggestions | ALL | authenticated | `auth.uid() = user_id` (with_check identical) |

## Foreign keys

### Outgoing

| Column | References | On delete |
|---|---|---|
| `user_id` | `auth.users.id` | CASCADE |
| `place_id` | `places.id` | CASCADE |
| `parent_category_id` | `categories.id` | CASCADE |

### Incoming

None.

## Lifecycle

```
LLM produces place_profile.suggested_tags.new_proposals[] →
  dedupProposals against user.tags →
    rerouted (matches existing) → silent auto-apply (place_tags INSERT)
    genuinely new                → INSERT here (status='pending', type='tag')

LLM produces place_profile.category_signals (primary + sub_category) →
  apply-suggestions.ts decision tree (Phase 5.5):
    primary == place.current_category, sub-cat existing → silent apply
    primary == place.current_category, sub-cat NEW + conf ≥ 0.9
      → INSERT here type='subcategory', parent_category_id=current,
        target_category_name=NULL
    primary ≠ place.current_category AND sub-cat present (existing or new)
      AND sub-cat conf ≥ 0.9 →
        INSERT here type='subcategory', parent_category_id=LLM target,
        target_category_name=LLM target name
        (accept moves the place AND creates/reuses the sub-cat atomically)
    primary ≠ place.current_category AND no usable sub-cat AND
      primary conf ≥ 0.85 →
        INSERT here type='category_change', parent_category_id=NULL,
        target_category_name=LLM target name

Phase 5 + 5.5 moderation UI:
  accept (tag) → INSERT into public.tags + place_tags
  accept (subcategory, same parent) → INSERT subcategories + UPDATE places.subcategory_id
  accept (subcategory, NEW parent) → INSERT subcategories under target parent
                                     + UPDATE places.category_id + .subcategory_id atomically
  accept (category_change) → resolve target_category_name → UPDATE places.category_id
                             + NULL out places.subcategory_id (the old sub-cat lived
                             under the old parent and no longer applies)
  reject → status='rejected', resolved_at=now() (no entity created/changed)
```

## Notes

- **Migration**: `create_ai_suggestions_queue_table` (14.05.2026).
- **Why not auto-create the entity?** The whole point of the queue is to gate new vocabulary additions. Auto-creating would defeat the purpose; users need a chance to say "no, I don't want a 'speakeasy' sub-category, my 'cocktail-bar' covers it".
- **Why dedup index on `lower(proposed_value)`?** LLMs occasionally emit case variations (`"Cocktail-Bar"` vs `"cocktail-bar"`). The dedup must be case-insensitive.
- **`COALESCE` in the unique index**: tag proposals have NULL `parent_category_id` — Postgres treats NULL as distinct in unique indexes by default. The COALESCE coerces to a fixed sentinel so two tag proposals with the same `lower(proposed_value)` collide.
- **Consumed by**: `src/lib/ai/apply-suggestions.ts` (writer). Phase 5 will add a reader hook + UI.

## Open questions

- **Pending expiry**: no TTL. Phase 5 may add an auto-purge (e.g. reject after 30 days untouched).
- **Bulk accept**: a `POST /api/user/ai-suggestions/accept-bulk` endpoint will likely be useful when the queue gets large.
- **Confidence threshold tuning**: currently 0.85 for tags, 0.9 for new sub-categories. May need adjustment after observing real LLM output quality.
