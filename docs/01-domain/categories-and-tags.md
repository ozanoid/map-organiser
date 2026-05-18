---
title: Categories, Sub-categories & Tags
type: entity
domain: places
version: 1.1.0
last_updated: 18.05.2026
status: stable
sources:
  - src/lib/types/index.ts
  - src/lib/hooks/use-categories.ts
  - src/lib/hooks/use-subcategories.ts
  - src/lib/hooks/use-tags.ts
  - src/lib/map/category-icons.ts
  - src/lib/google/category-mapping.ts
  - src/lib/dataforseo/category-adapter.ts
  - src/lib/ai/extract/category-resolver.ts
  - src/components/filters/category-filter.tsx
  - src/components/filters/tag-filter.tsx
  - src/components/places/inline-category-creator.tsx
  - src/components/places/inline-tag-input.tsx
  - src/app/(app)/settings/page.tsx
related:
  - "[[places]]"
  - "[[users-and-profiles]]"
  - "[[../02-backend/schema/categories]]"
  - "[[../02-backend/schema/subcategories]]"
  - "[[../02-backend/schema/tags]]"
  - "[[../02-backend/schema/place_tags]]"
  - "[[../05-flows/full-profile-flow]]"
---

# Categories, Sub-categories & Tags

Three parallel classification systems for Places:

- **Categories** — single-select parent classification per place (1:1 optional). Used to color/icon markers on the map. 12 defaults are seeded on signup; users can add more.
- **Sub-categories** — single-select granular classification under a parent category (Phase 2). Per-user, ~62 defaults seeded on signup. AI can propose new ones via the moderation queue (Phase 5). Powers a cascading filter UI and finer-grained taxonomy without bloating the parent list. See [[../02-backend/schema/subcategories]].
- **Tags** — free-form multi-select labels. Many-to-many with places via `place_tags`. No defaults. AI can propose new tag names via the moderation queue (Phase 5).

All three are per-user. Categories and Tags have free-form `color`. All three filter the places list (sub-cat as cascade pills under the parent).

## Sub-categories at a glance

Each parent category carries an optional bag of sub-cat slugs. Defaults seeded by `seed_default_subcategories_for_user()` (DB trigger, fires after `create_default_categories` on signup):

| Parent | Default sub-cat slugs (snapshot — see [[../02-backend/schema/subcategories]] for the canonical seed) |
|---|---|
| Restaurant | fine-dining, casual, brunch, steakhouse, seafood, sushi, pizza, kebab, vegan-restaurant, fast-food |
| Cafe | specialty-coffee, brunch-cafe, dessert-cafe, bakery-cafe, book-cafe |
| Bar & Nightlife | cocktail-bar, wine-bar, pub, beer-garden, nightclub, rooftop-bar, sports-bar, jazz-bar, karaoke-bar |
| Hotel & Accommodation | boutique-hotel, luxury-hotel, hostel, bed-and-breakfast, resort |
| Shopping | mall, boutique, local-market, department-store, souvenir-shop |
| Museum & Culture | art-museum, history-museum, science-museum, contemporary-art, gallery |
| Park & Nature | urban-park, national-park, botanical-garden, viewpoint, hiking-trail |
| Beach | sandy-beach, rocky-beach, beach-club, secluded-cove |
| Gym & Sports | fitness-center, yoga-studio, climbing-gym, swimming-pool, sports-arena |
| Health & Medical | pharmacy, clinic, hospital, spa, dental |
| Entertainment | cinema, theater, concert-venue, amusement-park, escape-room, comedy-club |
| Other | (empty by design) |

Places carry `places.subcategory_id uuid REFERENCES subcategories.id ON DELETE SET NULL`. The cascading filter UI (`CategoryFilter`) renders sub-cat pills under each *active* parent; URL state mirrors via `?subcategory=<id,id>`.

### AI interaction with sub-categories

- **Lite path** (Add Place dialog): `src/lib/ai/extract/category-resolver.ts` maps Google `types` to a `(primary, sub_category)` tuple. The dialog auto-pre-selects the sub-cat pill when `sub_category_confidence ≥ 0.85`.
- **Full path** (background): the Gemini full profile can propose new sub-cat slugs. The 4-band apply policy in `src/lib/ai/apply-suggestions.ts` silent-applies existing matches and queues new ones for moderation. Phase 5.5 added a 4th band — if the LLM's parent category disagrees with the place's current category, the proposal is bundled with a category move; accept-time atomically updates `places.category_id` AND `places.subcategory_id`. See [[../05-flows/full-profile-flow#auto-apply-policy-4-band]].

## Tags (unchanged, with new AI consumers)

Free-form, per-user, multi-select. The AI Phase 4 full profile produces two tag signals: `matched_existing` (UUIDs of user tags the LLM recognized) and `new_proposals` (lowercase-hyphenated strings). Existing matches silent-apply; new proposals run through `src/lib/ai/dedup.ts` fuzzy match — variations of existing tags get rerouted, true novelty lands in the moderation queue. See [[../02-backend/schema/ai_suggestions_queue]].

Both categories and tags also feed the AI's prompt context — the LLM sees the user's full vocabulary so it can pick from existing entities rather than invent variations.

## Categories

### Shape — `public.categories`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. |
| `name` | text | yes | Unique per user (`categories_user_id_name_key`). |
| `color` | text | yes | Hex like `'#EF4444'`. Default `'#059669'`. |
| `icon` | text | yes | Lucide icon name. Default `'map-pin'`. |
| `sort_order` | int | yes | Display order. Default 0. |
| `is_default` | boolean | yes | Default `false`. `true` for the 12 seeded categories. |
| `created_at` | timestamptz | no | `default now()`. |

### Invariants

- **Unique name per user.** Enforced by `categories_user_id_name_key`.
- **A Place has at most one Category.** `places.category_id` is nullable FK; no junction.
- **Default categories aren't special at the DB level.** `is_default = true` is a marker — they can still be renamed, recolored, or deleted by the user (no protection).

### The 12 default categories

Seeded by the `create_default_categories()` trigger on profile INSERT (see [[users-and-profiles]]).

| # | Name | Color | Icon (lucide) |
|---|---|---|---|
| 0 | Restaurant | `#EF4444` | `utensils` |
| 1 | Cafe | `#F97316` | `coffee` |
| 2 | Bar & Nightlife | `#8B5CF6` | `wine` |
| 3 | Hotel & Accommodation | `#3B82F6` | `bed-double` |
| 4 | Shopping | `#EC4899` | `shopping-bag` |
| 5 | Museum & Culture | `#6366F1` | `landmark` |
| 6 | Park & Nature | `#22C55E` | `trees` |
| 7 | Beach | `#06B6D4` | `umbrella` |
| 8 | Gym & Sports | `#F59E0B` | `dumbbell` |
| 9 | Health & Medical | `#14B8A6` | `heart-pulse` |
| 10 | Entertainment | `#A855F7` | `ticket` |
| 11 | Other | `#6B7280` | `map-pin` |

These are the only icons the canvas marker renderer (`src/lib/map/category-icons.ts`) knows about. **User-added categories with custom icon names will fall back to `map-pin`** unless the renderer is extended.

### External category mapping

Inbound Place data brings Google or DataForSEO category strings. Two adapters map them to a default category:

- `src/lib/google/category-mapping.ts` — Google `types` array → default category id (by name match).
- `src/lib/dataforseo/category-adapter.ts` — DataForSEO category strings → default category id.

User-added categories never get external mapping; they're set manually.

### Code surface (categories)

- **Hook:** `src/lib/hooks/use-categories.ts` — query key `["categories"]`. Includes mutations.
- **Filter:** `src/components/filters/category-filter.tsx` — multi-select pills (`PlaceFilters.category_ids`).
- **Inline creator:** `src/components/places/inline-category-creator.tsx` — used inside the place dialog.
- **Settings UI:** `src/app/(app)/settings/page.tsx` (Categories tab) — list, add, edit, delete, reorder via `sort_order`.
- **Map markers:** `src/lib/map/category-icons.ts` — canvas-renders the category color + lucide icon into a Mapbox image.

---

## Tags

### Shape — `public.tags`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | — |
| `user_id` | uuid | yes | FK → `auth.users.id`. |
| `name` | text | yes | Unique per user (`tags_user_id_name_key`). |
| `color` | text | no | Hex; optional. |
| `created_at` | timestamptz | no | `default now()`. |

### Shape — `public.place_tags` (junction)

| Field | Type | Required | Notes |
|---|---|---|---|
| `place_id` | uuid | yes | FK → `places.id` (CASCADE). |
| `tag_id` | uuid | yes | FK → `tags.id` (CASCADE). |

**Primary key:** `(place_id, tag_id)` composite. A given (place, tag) pair is unique.

### Invariants

- **Unique name per user.** Enforced by `tags_user_id_name_key`.
- **A Place can have many Tags.** No upper bound; UI shows them as pills.
- **No defaults.** Tags start empty for every user.
- **Tags are presentational.** They don't affect routing, auto-plan, sharing — only filtering.

### Code surface (tags)

- **Hook:** `src/lib/hooks/use-tags.ts` — query key `["tags"]`. Includes mutations.
- **Filter:** `src/components/filters/tag-filter.tsx` — multi-select pills (`PlaceFilters.tag_ids`).
- **Inline editor on Place:** `src/components/places/inline-tag-input.tsx` — comma/space separated, creates new tags on the fly.
- **Settings UI:** `src/app/(app)/settings/page.tsx` (Tags tab) — list, add, recolor, delete.

---

## Categories vs Tags — when to pick which

The mental model the UI enforces:

| Decision | Category | Tag |
|---|---|---|
| How many per place? | 0 or 1 | 0..many |
| What changes when applied? | Marker color & icon on the map | Filter pills only |
| Drives auto-plan? | Yes (category buckets order within day) | No |
| Free-form name? | Yes, but typically reused | Yes, more disposable |
| Stable default set? | Yes (12 defaults seeded) | No |

A pragmatic rule: **Category = "what kind of place is this?"** (restaurant, museum, …). **Tag = "what's the angle / context?"** (date-night, family-friendly, michelin-2024, …).

## Relationships

| Entity | Cardinality | Via |
|---|---|---|
| [[users-and-profiles\|User]] | 1:N | `user_id` on both tables |
| [[places\|Place]] (Category) | 1:N | `places.category_id` |
| [[places\|Place]] (Tag) | M:N | `place_tags` junction |

## RLS posture

| Table | Policy | Roles | Predicate |
|---|---|---|---|
| `categories` | ALL own | authenticated | `auth.uid() = user_id` |
| `tags` | ALL own | authenticated | `auth.uid() = user_id` |
| `place_tags` | ALL own (via place) | authenticated | `place_id IN (SELECT id FROM places WHERE user_id = auth.uid())` |

## Open questions

- **Icon support beyond the 12.** Adding a new category lets the user pick any lucide icon name, but the canvas renderer only ships sprites for the default 12. Worth either (a) restricting the icon picker to known sprites or (b) generalizing the renderer.
- **Tag merging.** If two users typo a tag ("cafe" / "cafes"), there's no merge UX. Probably fine at current scale but worth noting if tags grow.
