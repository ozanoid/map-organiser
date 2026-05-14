---
title: Lite Profile Flow
type: flow
domain: places
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - src/lib/ai/extract/lite-profile.ts
  - src/lib/ai/extract/category-resolver.ts
  - src/lib/ai/extract/features-extractor.ts
  - src/lib/ai/extract/suggestions-from-profile.ts
  - src/app/api/places/parse-link/route.ts
  - src/components/places/add-place-dialog.tsx
related:
  - "[[manual-place-create-flow]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../03-frontend/components/places]]"
  - "[[../01-domain/categories-and-tags]]"
---

# Lite Profile Flow (AI Phase 3)

The first AI-touching surface a user sees: when they paste a Google Maps URL
into the Add Place dialog, suggestion chips materialize instantly.

**No LLM call.** Everything is rule-based — Google `types` mapping, DataForSEO
`attributes` flag extraction, fuzzy match against the user's existing tags
and lists. Phase 4 will produce the full `place_profile` via Gemini once
reviews are fetched.

## Trigger

User pastes a Google Maps URL into `AddPlaceDialog`, OR PWA share-target
opens the dialog with `initialUrl`. Either way, `parseLink.mutate()` runs.

## Steps

```
1. POST /api/places/parse-link { url }
       │  • parseMapsUrl(url) → place id / coords / search
       │  • Google or DataForSEO fetch (existing logic)
       │  • placeData ← transform result
       │
       ▼ NEW (Phase 3)
2. buildLiteProfileForResponse(supabase, user.id, placeData, extended?)
       │  • SELECT profiles.ai_features_enabled
       │  • If off → return null (UI skips chip rendering)
       │  • SELECT tags, lists (user-scoped via RLS)
       │  • buildLiteProfile(input, { tags, lists })
       │       ├─ resolveCategorySignals(types, name)
       │       │     → primary, primary_confidence,
       │       │       sub_category (slug), sub_category_confidence,
       │       │       secondary_role
       │       ├─ extractFeaturesLite({ types, attributes, place_topics,
       │       │                       category_ids, price_level,
       │       │                       total_photos, is_claimed })
       │       │     → cuisine_types, dietary, seating, distinctive,
       │       │       price_range (atmosphere/occasions/music/crowd are
       │       │       LLM-only; Phase 4 fills them)
       │       ├─ matchTagsFromFeatures(features, tags)
       │       │     → suggested_tags.matched_existing
       │       │     (new_proposals stays [] — lite path doesn't speculate)
       │       └─ matchListsFromProfile(features, ctx, lists)
       │             → city/country/category/cuisine fuzzy match
       │
       ▼
3. Response includes lite_profile: PlaceProfile | null
       │
       ▼
4. AddPlaceDialog consumes lite_profile:
       │  • useEffect: if sub_category_confidence >= 0.85 AND the user
       │    has a matching subcategory under the auto-resolved parent →
       │    setSubcategoryId(match.id)
       │  • "✨ AI Suggestions" panel renders:
       │      ├─ Tags row: matched_existing chips (NOT pre-selected; user clicks)
       │      └─ Lists row: matched lists chips (NOT pre-selected)
       │  • Sub-category strip under the Category dropdown:
       │      all parent subcategories; the AI-suggested one carries a
       │      ✨ Sparkles icon
       │
       ▼
5. User clicks chips to accept / save
       │  • POST /api/places { ..., subcategory_id, tag_ids[], list_ids[] }
       │
       ▼
6. (Phase 4 — not yet implemented)
       Background enrichment cascade still runs:
       enrich/info → enrich/reviews → enrich/profile (full LLM profile,
       Phase 4). Full profile will silently auto-apply matched_existing
       tags + lists and queue new_proposals for moderation.
```

## Auto-apply policy in this phase

| Where | What auto-applies | What requires a click |
|---|---|---|
| Add Dialog (parse-link response) | **Sub-category** when `sub_category_confidence ≥ 0.85` AND a matching `subcategories` row exists under the auto-resolved parent | **Tags**, **Lists** — chip shown, user toggles to accept |
| Background (Phase 4 placeholder) | Will auto-apply `matched_existing` tags + lists silently; queue `new_proposals` | — |

Tag and list chips stay opt-in in the dialog because the user is right
there and can act. The sub-category is one click deep behind a dropdown,
so a confident pre-select removes friction without ambiguity.

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 2 | `placeData` + optional `extended` (DataForSEO attrs/topics/etc.) | `PlaceProfile` with `completeness: "lite"` |
| 4 | `lite_profile` + user's subcategories | Pre-selected `subcategoryId` (when confident) + suggestion chips |
| 5 | User's chip clicks + form fields | New `places` row with `subcategory_id`, joined `place_tags`, joined `list_places` |

## Failure modes

- **AI features disabled** (`profiles.ai_features_enabled = false`) → route returns `lite_profile: null` → dialog renders without the AI panel.
- **No types in placeData** → `resolveCategorySignals` returns primary "Other", confidence 0. No sub-cat auto-selects; no cuisine extraction. Tag/list chips may still appear if other features matched.
- **Google path (no `extended`)** → `attributes`/`place_topics`/`is_claimed`/`total_photos` are absent. Lite profile still works but `features.dietary/seating/distinctive` will be sparse. This is acceptable — Phase 4's full profile makes up the gap.
- **Build throws** → fail-soft `console.warn` + `lite_profile: null`. The parse never fails because of an AI subsystem.
- **No matching subcategory in user's table** → sub-cat doesn't auto-select; the strip still shows all parent subcategories without a Sparkles badge.

## Performance

Sub-second overhead. Worst case (~70 user subcategories + 50 attributes + 10 tags + 10 lists):
- 2 Supabase queries in parallel (~50ms).
- Rule-based extraction: O(types.length) + O(attributes.length) + O(tags.length × candidates) where Levenshtein is O(64²) capped.
- Net: ~100ms added to a ~3-4s parse-link round trip.

## Related code

- **Extractors**: `src/lib/ai/extract/{lite-profile,category-resolver,features-extractor,suggestions-from-profile}.ts`.
- **Route wiring**: `src/app/api/places/parse-link/route.ts#buildLiteProfileForResponse`.
- **UI integration**: `src/components/places/add-place-dialog.tsx` — `aiSuggestions` memo + `suggestedSubcategory` memo + the "AI Suggestions" panel.
- **POST consumer**: `src/app/api/places/route.ts` and `src/lib/hooks/use-places.ts#CreatePlaceInput` now accept `subcategory_id`.

## Open questions

- **Bulk import path (`/api/places/import-batch`)** doesn't yet call `buildLiteProfile`. Phase 4 will integrate AI categorization there (likely with the full LLM call for the smaller, slower batch path). Until then, batch-imported places still rely on the existing `resolveCategoryId` rule-based mapping with NO sub-category, NO tag/list suggestions.
- **Sub-category creation when user has none yet for that parent**: the strip simply doesn't render. Phase 5's moderation queue handles AI-proposed new sub-cats from the full profile, but a "create on the fly" affordance in the dialog could close the gap earlier.
- **Tag chip dedup**: the strip can show duplicates if two user tags fuzzy-match the same feature. Today the matcher de-dups by tag ID, so this is theoretically OK; worth verifying with multilingual tag names.
