---
title: Controlled vocabulary tables
type: table
domain: backend
version: 1.0.0
last_updated: 05.08.2026
status: stable
sources:
  - src/lib/vocabulary/read.ts
  - src/lib/ai/apply-suggestions.ts
  - src/lib/ai/generate-profile.ts
  - src/lib/ai/prompts/place-profile-full.ts
  - src/lib/ai/schemas/place-profile.ts
related:
  - "[[_README]]"
  - "[[tags]]"
  - "[[place_tags]]"
  - "[[ai_suggestions_queue]]"
  - "[[../rls-policies]]"
  - "[[../../01-domain/categories-and-tags]]"
  - "[[../../05-flows/full-profile-flow]]"
tags:
  - ai
  - vocabulary
---

# Controlled vocabulary — `vocabulary_*`

Four tables holding **one dictionary shared by every account**. This is the only
global read surface in the app — everything else is `auth.uid() = user_id`. The
app never writes to `vocabulary_concepts` or `vocabulary_aliases`; the monthly
refresh job does, under the service role.

## Why it exists

`place_profile.features.*` values were generated one place at a time with no
global view, so they fragmented. Measured over 400 places:

| Axis | Distinct values | Symptom |
|---|---|---|
| `occasions` | 368 | `date night` and `date-night` are separate entries |
| `dietary` | 28 | five spellings of "vegetarian options" |
| `distinctive` | 927 | 858 of them appear on exactly one place |

The free-form tag path had the same disease from the same cause: 920 pending
proposals, 804 distinct, 85.8% proposed by a single place. A per-place LLM
cannot know what it called the same thing last time.

Handing it a fixed vocabulary turns open-ended generation into closed-set
classification — more reliable, and unlike free text, filterable.

## The four tables

### `vocabulary_concepts`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | text | no | — | **PK**. `c_<sha1>`, permanent. `tags.concept_id` points here, so a rename never breaks a tag. |
| `canonical_name` | text | no | — | UNIQUE. The term a person would actually say. |
| `definition` | text | no | — | Shown to the LLM for tag-destined concepts. |
| `family` | text | no | — | CHECK, 17 values — see below. |
| `bucket` | text | no | — | `features.<axis>` or `tag`. Decides where a match lands. |
| `region` | text | no | `'GLOBAL'` | `UK`, `NL`, `PT`, `TR`… Region-locked concepts stay scoped. |
| `coverage` | numeric | no | `0` | Measured share of the reference corpus at the last refresh. |
| `support` | int | no | `0` | Places carrying it at the last refresh. |
| `status` | text | no | `'active'` | CHECK: `active` / `deprecated_too_broad` / `deprecated_too_rare`. |
| `version` | int | no | `1` | Refresh generation that last touched it. |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |

**Families and where they land.** Seven feed the existing `place_profile.features`
axes; ten feed the tag system. `features.distinctive` and `features.price_range`
are deliberately NOT in the vocabulary — see [[../../01-domain/categories-and-tags]].

| → `features.*` | → tag system |
|---|---|
| CUISINE · DIETARY · ATMOSPHERE · OCCASION · SEATING · CROWD · MUSIC | SCENE · RITUAL · SETTING · ACTIVITY · PREPARATION · PROVENANCE · DRINKS · POLICY · SOCIAL · VALUE |

**`status` is not a delete.** A concept is never removed — existing `place_tags`
rows must stay meaningful.

- `deprecated_too_broad` (>25% coverage) is still loaded and still offered to the
  profile prompt. Describing a place and filtering a library are different jobs
  and the ceiling belongs only to the second: `cozy` sits above half the corpus,
  useless as a filter, but the model still has to call a cozy room cozy. Excluding
  these from the prompt was measured twice, costing 0.54 discriminating
  matches/place the first time and 11% of axis values drifting off-vocabulary the
  second. They are excluded from `tagConcepts`, so they describe but never tag.
- `deprecated_too_rare` (<4 places) is excluded outright.

### `vocabulary_aliases`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `alias` | text | no | **PK**. Normalized raw phrase. |
| `concept_id` | text | no | FK → `vocabulary_concepts.id` (CASCADE). |

Every phrase that resolves to a concept, produced as a by-product of clustering.
Two consumers: the rule-based lite path, which must stay LLM-free and
sub-second, and read-time resolution of profiles written before the dictionary
existed — which is why no 460-place regeneration was needed.

### `vocabulary_candidates`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK**. |
| `raw_value` | text | no | — | The phrase the vocabulary could not express. |
| `user_id` | uuid | no | — | FK → `auth.users.id` (CASCADE). |
| `place_id` | uuid | yes | — | FK → `places.id` (CASCADE). |
| `source` | text | no | `'profile_gap'` | CHECK: `profile_gap` / `user_tag` / `attribute`. |
| `created_at` | timestamptz | no | `now()` | — |

**The JOB B channel.** Surfaced to nobody; the sole input to the next refresh.
This is what keeps the vocabulary from ossifying — a closed-set extractor with no
gap channel was measured finding exactly ONE new concept across 400 places,
because it had stopped mining and started classifying.

Not a moderation queue. Nothing here is ever shown or applied. That is the
difference from [[ai_suggestions_queue]], which asked the user to adjudicate
every proposal and reached 920 pending rows.

### `vocabulary_migrations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**. |
| `run_at` | timestamptz | — |
| `version` | int | Refresh generation. |
| `op` | text | CHECK: `ADD` / `GROW` / `DEPRECATE` / `REACTIVATE` / `MERGE` / `RENAME`. |
| `concept_id`, `detail`, `value` | text | — |

Audit trail. `ADD` and `GROW` are safe and silent; `DEPRECATE` and `MERGE` are
logged because they change what a user already sees.

## Indexes

| Name | Table | Columns | Purpose |
|---|---|---|---|
| `idx_vocabulary_concepts_active` | concepts | `(family, coverage desc)` WHERE `status='active'` | Prompt assembly hot path. |
| `idx_vocabulary_concepts_name` | concepts | `canonical_name` UNIQUE | One concept per term. |
| `idx_vocabulary_aliases_concept` | aliases | `concept_id` | Reverse lookup. |
| `idx_vocabulary_candidates_value` | candidates | `lower(raw_value)` | Refresh aggregation. |
| `idx_vocabulary_migrations_run` | migrations | `run_at desc` | Log reads. |
| `idx_tags_concept` | tags | `concept_id` WHERE NOT NULL | Concept → user tags. |

## RLS

| Table | Policy | CMD | Role | Predicate |
|---|---|---|---|---|
| `vocabulary_concepts` | Vocabulary is readable by all authenticated | SELECT | authenticated | `true` |
| `vocabulary_aliases` | Aliases are readable by all authenticated | SELECT | authenticated | `true` |
| `vocabulary_candidates` | Users manage own vocabulary candidates | ALL | authenticated | `auth.uid() = user_id` |
| `vocabulary_migrations` | *(none)* | — | — | RLS on, no policy → service role only |

The first two are the app's only global-read tables. Neither has an
insert/update/delete policy, so writes require the service role.

## `tags.concept_id`

`tags` gains a nullable `concept_id text REFERENCES vocabulary_concepts(id) ON
DELETE SET NULL`.

- NULL — the user made this tag themselves. Untouched by refreshes.
- set — derived from a dictionary concept.

A matched concept becomes a real row in `tags` + `place_tags` rather than a
parallel junction, so the filter panel, saved filters and tag pills all keep
working with no change. It also gives "invisible until matched" for free: a
concept only appears in someone's tag list once one of their places matches it.

## Evidence must read like a sentence

`applyMatchedConcepts` rejects any assignment whose evidence matches
`^[a-z0-9_]+$`. That is the shape of a DataForSEO attribute key — `has_wi_fi`,
`welcomes_lgbtq` — which sits in the prompt's context and which the model
sometimes cites in place of a review quote (9.7% of assignments when measured).

The attribute is usually true. It is just not *evidence* in the sense the design
needs: a tag earns its place by being something reviewers noticed, and an
attribute is a checkbox that lands on whichever places have the flag set and
happen to get cited. That produces arbitrary partial coverage, which filters
worse than no tag at all.

## Related code

- `src/lib/vocabulary/read.ts` — load, serialize for the prompt, resolve aliases.
- `src/lib/ai/apply-suggestions.ts` — `applyMatchedConcepts`, `recordConceptGaps`.
- `src/lib/ai/prompts/place-profile-full.ts` — prompt sections 6, 6b, 6c.
- `src/lib/ai/schemas/place-profile.ts` — `matched_concepts`, `concept_gaps`.

## Open questions

- **Refresh job.** The incremental refresh is validated as a harness (100% anchor
  stability, quality level with a from-scratch rebuild) but is not yet wired as a
  scheduled job. Until it runs, the dictionary is static.
- **`user_tag` candidates.** A tag the user creates by hand is the highest-quality
  signal available and `source` has a slot for it, but nothing writes it yet.
- **Bootstrap bias.** Seeded from three accounts, all London-heavy. Region-scoped
  concepts mitigate it; a wider corpus is the real fix.
