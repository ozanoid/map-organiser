---
title: Place Import Flow
type: flow
domain: places
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/places/import-parse/route.ts
  - src/app/api/places/import-batch/route.ts
  - src/app/api/places/bulk-enrich-reviews/route.ts
  - src/lib/stores/import-store.ts
  - src/app/(app)/import/page.tsx
  - src/lib/google/takeout-parser.ts
  - src/lib/dataforseo/business-info.ts
related:
  - "[[../01-domain/places]]"
  - "[[../03-frontend/stores/import-store]]"
  - "[[../02-backend/api-routes/places]]"
  - "[[../04-integrations/dataforseo]]"
---

# Place Import Flow

Batched, client-driven bulk import of saved Google Maps places from a Takeout export. The current production path (v2 design replaced an earlier NDJSON-streaming endpoint with this).

## Trigger

User goes to `/import`, picks a CSV or GeoJSON file (typically downloaded from Google Takeout → Maps → "Saved" or "Want to go"), configures options, clicks Start.

## Steps

```
1. Pick file
       │  setFile(name, size) → useImportStore: phase = "options"
       ▼
2. Pick visit_status, lists, tags (optional)
       │  toggleListId / toggleTagId / setVisitStatus on the store
       ▼
3. POST /api/places/import-parse  (multipart file)
       │  • Parses CSV / GeoJSON server-side
       │  • Returns { places: ParsedPlaceData[], total }
       │  • No DB writes
       ▼
4. startImport(total) on the store → phase = "importing"
       │
       ▼ Client loop (batch size = 3):
5. POST /api/places/import-batch  { places: batch, visit_status, list_ids, tag_ids }
       │  For each of the 3 places:
       │    • DataForSEO fetchBusinessInfoLive
       │    • transformBusinessInfoToPlaceData
       │    • Dedup by google_place_id (SELECT places WHERE ...)
       │    • If new: INSERT places + INSERT list_places + INSERT place_tags + photo download
       │    • Track usage (dataforseo.business_info)
       │  Returns { results: [{ name, status, reason?, placeId? }] }
       │
       │  Client checks useImportStore.getState().cancelled between batches
       │
       ▼ Loop continues until done or cancelled
6. finishImport(result) → phase = "done"
       │  Aggregates: imported count, failed count, enriched count, skipped[], importedPlaceIds[]
       │
       ▼
7. Background: POST /api/places/bulk-enrich-reviews { placeIds }
       │  • Iterates placeIds in batches of 5
       │  • For each: fetch reviews via DataForSEO, transform, UPDATE places.google_data.reviews
       │  • 500 ms delay between places (rate-limit politeness)
       │  • Fire-and-forget from the client
       ▼
8. Done
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 3 | Takeout file (CSV/GeoJSON) | Parsed `ParsedPlaceData[]` (no DB write) |
| 5 (per batch) | 3 parsed places + import options | 3 new `places` rows + `list_places` + `place_tags` + photo in Storage |
| 7 (per batch) | up to 5 placeIds with `google_data.cid` set | Reviews merged into `google_data.reviews` |

## Failure modes

- **Parse fails (step 3):** Invalid file format. UI shows error, no further action.
- **Per-place DataForSEO failure (step 5):** Marked `skipped` with reason. Batch continues. Place is NOT inserted.
- **Per-place duplicate (step 5):** Same `google_place_id` already exists for this user. Marked `skipped` with `reason: "duplicate"`. UPDATE may run if attaching new list/tags.
- **Photo download fails (step 5):** Place is still inserted; `google_data.photo_storage_url` is null. User can run `/api/places/migrate-photos` later.
- **Vercel Function timeout (step 5):** A batch of 3 takes ~15–20 s. If one takes longer, the batch may time out. Place is not inserted. Worth lowering batch to 2 if timeouts become common.
- **Cancel:** `useImportStore.requestCancel()` sets `cancelled = true`. Client loop checks between batches and exits. Already-inserted places stay.
- **Reviews batch failure (step 7):** Logged silently. Place keeps existing data. No retry.

## Why client-driven batches (not server-side stream)

The v1 design used a single long-running `/api/places/import` endpoint that NDJSON-streamed progress. Vercel Function timeouts (~60s default, with cold-start variance) made this unreliable for large imports. The v2 redesign moved the loop client-side:

- Each batch is a short HTTP request, well under any timeout.
- Cancel is cooperative, with the store as shared state.
- Progress UI reads directly from the store.

The legacy `/api/places/import` route still exists; verify whether any UI still uses it.

## Related code

- `src/app/(app)/import/page.tsx` — the import page UI.
- `src/lib/stores/import-store.ts` — the Zustand store; see [[../03-frontend/stores/import-store]].
- `src/app/api/places/import-parse/route.ts` — parse endpoint.
- `src/app/api/places/import-batch/route.ts` — batch endpoint.
- `src/app/api/places/bulk-enrich-reviews/route.ts` — background reviews endpoint.
- `src/lib/google/takeout-parser.ts` — `parseTakeoutGeoJson`, `parseTakeoutCsv`.
- `src/lib/dataforseo/business-info.ts` — `fetchBusinessInfoLive`.
- `src/lib/dataforseo/transform.ts` — adapter into our shape.
- `src/lib/dataforseo/photo.ts` — `downloadAndStorePhotoFromUrl`.

## Open questions

- **Legacy `/api/places/import`.** Confirm if anything still hits it, otherwise delete.
- **Batch size.** Fixed at 3. Auto-tune based on observed per-place latency would help in slow-network regions.
- **Reviews retry.** No retry on review batch failures — places stay without reviews until the user manually runs refresh. A "retry failed reviews" button in Settings could help.
