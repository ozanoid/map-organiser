---
title: Manual Place Create Flow
type: flow
domain: places
version: 1.2.1
last_updated: 16.10.2026
status: stable
sources:
  - src/components/places/add-place-dialog.tsx
  - src/app/api/places/parse-link/route.ts
  - src/app/api/places/route.ts
  - src/app/api/places/[id]/enrich/route.ts
related:
  - "[[place-import-flow]]"
  - "[[share-target-flow]]"
  - "[[instagram-import-flow]]"
  - "[[lite-profile-flow]]"
  - "[[full-profile-flow]]"
  - "[[../01-domain/places]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/dataforseo]]"
  - "[[../04-integrations/gemini]]"
---

# Manual Place Create Flow

> **Telemetry (v1.16.0):** the enrich chain's profile step now exports LLM spans to Langfuse. Flow behavior unchanged. See [[observability-flow]].

How a single place is added — by pasting a Google Maps URL into the Add Place dialog. The same flow handles places coming in via the PWA share target (see [[share-target-flow]]).

> **Instagram links branch off (v1.28.0).** The same dialog accepts an Instagram post or reel link — pasted, or arriving as `/map?add=` from the iOS Shortcut. It never reaches `parse-link`: the dialog switches to the Instagram import, which adds every venue it can pin with no preview or save step. Pasted into the header's dialog, the link is handed to `/map?add=` and the map page runs the import (v1.28.1). Any other Instagram link (a profile) gets an inline hint and is not sent anywhere. See [[instagram-import-flow]].

## Trigger

User opens the Add Place dialog from:

- `AppHeader` → Add Place button.
- `MapContent` → FAB.
- Share-target redirect — or the iOS Shortcut — to `/map?add=<url>` (the dialog opens automatically with `initialUrl`).

## Steps

```
1. AddPlaceDialog opens (initialUrl optional)
       │
       ▼
2. User pastes Google Maps URL (or initialUrl is set)
       │  • Instagram post/reel link (parseInstagramPostUrl)? → the dialog renders
       │    InstagramImportPanel instead (the header's dialog hands the link
       │    to /map?add= first); see [[instagram-import-flow]]
       │  • Any other Instagram link (isInstagramUrl)? → inline hint "That's an
       │    Instagram profile or page, not a post. …"; nothing is sent
       ▼
3. useParseLink → POST /api/places/parse-link  { url }
       │  • src/lib/google/parse-maps-url.ts extracts identifiers:
       │      - ChIJ place_id (most preferred — exact match)
       │      - FTid → second hex decoded to Google CID (returns type="cid")
       │      - !3d!4d (POI actual coords) preferred over @lat,lng (viewport)
       │      - Falls back to {query, lat, lng} for /maps/place/Name/@…/ URLs
       │      - Short links resolved server-side; resolvedUrl exposed downstream
       │  • If profiles.google_places_enabled AND google_api_key exists:
       │      Google path: getPlaceDetails / searchPlace → ParsedPlaceData
       │  • Else: DataForSEO path:
       │      - place_id → keyword: place_id:ChIJ…
       │      - cid (from FTid or ?cid=) → keyword: cid:<decimal>  (exact match)
       │      - search → reverseGeocode(coords) to pad keyword with full_address,
       │        location_coordinate widened to 2km
       │      - lat/lng fallback → keyword: "lat,lng" + 200m
       │      - fetchBusinessInfoLive → transformBusinessInfoToPlaceData
       │  • trackUsage tracks the API call
       │  • If ai_features_enabled: buildLiteProfileForResponse populates
       │    lite_profile inline (rule-based, no LLM call — see [[lite-profile-flow]])
       │  • Returns { ...ParsedPlaceData, _provider, _fetchTimeMs, _extended?, lite_profile? }
       │
       ▼
4. Dialog shows preview (photo, rating, hours, website, phone)
       │  • Auto-resolves category via resolveCategoryId (Google types → default category)
       │  • Sub-category strip auto-pre-selects when lite_profile confidence ≥ 0.85
       │    (✨ Sparkles icon on the suggested pill)
       │  • AI Suggestions panel renders tag + list chips (opt-in — user clicks to accept)
       │  • User edits: category, sub-category, rating, notes, lists, tags, visit_status
       │
       ▼
5. Click "Save" → useCreatePlace → POST /api/places  { all fields, photoRef?, subcategory_id? }
       │  • Server INSERTs into places (now with subcategory_id since Phase 3)
       │  • If photoRef provided: downloadAndStorePhotoFromUrl → google_data.photo_storage_url
       │  • If list_ids: INSERT list_places (auto sort_order)
       │  • If tag_ids: INSERT place_tags
       │  • Sets visited_at/booked_at from visit_status
       │  • Strips reviews/photos/editorialSummary from google_data before INSERT
       │  • Returns the created Place
       │
       ▼
6. POST /api/places/[id]/enrich?step=info  (awaited)
       │  • DataForSEO fetchBusinessInfoLive (or Google if applicable)
       │  • Merges extended fields into google_data
       │  • Downloads main photo to Storage
       │  • UPDATE places — google_data fields filled in, photo_storage_url set
       │
       ▼
7. POST /api/places/[id]/enrich?step=reviews  (fire-and-forget)
       │  • Background fetch reviews
       │  • Merges into google_data.reviews
       │  • Takes ~30s; UI doesn't wait
       │  • When ai_features_enabled: chain-fires step=profile (Phase 4) — see [[full-profile-flow]]
       │
       ▼
8. Dialog closes; React Query invalidates ["places"] → list and map refetch
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 3 | Google Maps URL | `ParsedPlaceData` (no DB write yet) |
| 5 | Full place form data | New `places` row + `list_places` + `place_tags` + photo (if `photoRef`) |
| 6 | Place ID | `places.google_data` updated with extended fields |
| 7 | Place ID | `places.google_data.reviews` populated |

## Provider preference (step 3)

| Condition | Path |
|---|---|
| `profiles.google_places_enabled = true` AND `profiles.google_api_key_enc` set | **Google Places** |
| Otherwise | **DataForSEO** |

The preview UI shows which provider was used and the fetch time (`_provider`, `_fetchTimeMs`).

## Failure modes

- **Instagram link that is not a post (step 2):** caught in the dialog — an inline hint asks for a post or reel, and `parse-link` is not called.
- **Invalid URL (step 3):** `400` with the parse error. Dialog shows toast.
- **Place not found (step 3):** `404`. Dialog shows toast.
- **Both providers down (step 3):** `500`. Dialog shows generic error.
- **Save fails (step 5):** Dialog stays open with the user's choices preserved. Network glitch — retry usually works.
- **Duplicate (step 5):** `409`. The user already has this `google_place_id`. UI surfaces "this place is already in your collection".
- **Enrich info fails (step 6):** Place is still saved; user just doesn't get extended data immediately. Manual "Refresh Google data" from detail page can re-run.
- **Enrich reviews fails (step 7):** Silent. Reviews can be fetched later via `/api/places/[id]/enrich?step=reviews`.

## Related code

- `src/components/places/add-place-dialog.tsx`
- `src/app/api/places/parse-link/route.ts`
- `src/app/api/places/route.ts`
- `src/app/api/places/[id]/enrich/route.ts`
- `src/lib/google/parse-maps-url.ts`
- `src/lib/google/places-api.ts`
- `src/lib/dataforseo/business-info.ts`
- `src/lib/dataforseo/transform.ts`
- `src/lib/dataforseo/photo.ts`
- `src/lib/google/track-usage.ts`

## Open questions

- **Network-loss mid-save.** If the user is offline at step 5, the save fails outright. No retry queue. The Add Place dialog could persist its state to `localStorage` and offer a retry on reconnect.
- **Reviews enrichment race.** If the user navigates to the place's detail page immediately after step 6 but before step 7 completes, they see no reviews. The detail page should react to `google_data.reviews` becoming non-null (currently it just shows what's there at fetch time).
