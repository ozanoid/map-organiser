---
title: Instagram routes
type: route-group
domain: backend
version: 1.1.0
last_updated: 16.10.2026
status: stable
sources:
  - src/app/api/instagram/import/route.ts
  - src/app/api/instagram/import/[id]/route.ts
  - src/app/api/instagram/import/[id]/pick/route.ts
  - src/lib/instagram/import-job.ts
  - src/lib/instagram/provenance.ts
  - src/lib/instagram/types.ts
  - src/lib/instagram/url.ts
related:
  - "[[_README]]"
  - "[[places]]"
  - "[[../schema/import-jobs]]"
  - "[[../../05-flows/instagram-import-flow]]"
  - "[[../../03-frontend/hooks/use-instagram-import]]"
  - "[[../../04-integrations/hikerapi]]"
---

# Instagram routes

Three routes behind the Add Place dialog's Instagram mode: one starts an import
for a post URL and returns at once, one reports its progress in the shape the
dialog renders, and one adds the place the user picks for a venue the import
skipped. The work itself — reading the post, pinning venues, queueing places —
runs after the response (`after()`), and the places are created by the shared
import queue (`/api/cron/drain-imports`). Full sequence:
[[../../05-flows/instagram-import-flow]].

> **Database:** relies on the Instagram migration in
> [[../schema/import-jobs#instagram-migration]] (`import_jobs.kind`,
> `import_jobs.meta`, `places.source = 'instagram'`), applied to the live DB on
> 16.10.2026.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/instagram/import` | Required | Create (or reuse) an Instagram import job for a post URL; read it in the background. |
| `GET` | `/api/instagram/import/[id]` | Required | Progress and result of one job, shaped for the dialog. |
| `POST` | `/api/instagram/import/[id]/pick` | Required | Add the place the user picked for a skipped venue — one of the options the import stored for it. |

---

## Per-route detail

### `POST /api/instagram/import`

- **Source:** `src/app/api/instagram/import/route.ts`
- **Auth:** required (`supabase.auth.getUser()` → 401).
- **Body:** `{ url: string }` — Zod `BodySchema`, 1–2000 chars. Any text that
  contains an Instagram post/reel link is accepted; `parseInstagramPostUrl`
  extracts and canonicalises it to `https://www.instagram.com/p/<shortcode>/`.
- **Config:** `export const maxDuration = 120` — bounds the whole invocation,
  including the `after()` work that reads the post. The response itself waits
  only for a few DB round trips.
- **Gates (in order):**
  1. 400 `Invalid body`.
  2. 400 "That isn't an Instagram post or reel link."
  3. 503 "Instagram import isn't set up on this server." — `HIKERAPI_KEY` or
     `GOOGLE_GENERATIVE_AI_API_KEY` (via `isAiAvailable`) missing.
  4. 400 "Instagram import reads the post with AI. Turn on AI features in
     Settings." — `profiles.ai_features_enabled` is off.
  5. 400 "Instagram import needs a Google Places API key. Add one in Settings." —
     `getUserApiKeys` returned no Google key (the user's own key; admins get
     `GOOGLE_PLACES_API_KEY`). The `google_places_enabled` toggle scopes Maps-link
     lookups and is deliberately not consulted here (owner's decision,
     16.10.2026).
- **Reuse:** the user's newest `import_jobs` row with `kind = 'instagram'`,
  `file_name` = the canonical URL and `created_at` in the last 10 minutes
  (`REUSE_WINDOW_MS`) is returned as **`200 { jobId, reused: true }`** unless its
  stored `meta.phase` is `failed` or it is still `reading` after 3 min
  (`STALL_MS`, a lost background run) — so **Try again** gets a fresh job. The iOS Shortcut can fire twice and React
  re-mounts the dialog in development.
- **DB (session client):** `ensureInstagramTag` — `tags` SELECT (`ilike
  'instagram'`) and, on first use, INSERT `{ name: 'instagram', color: '#E4405F' }`;
  `import_jobs` INSERT `{ kind: 'instagram', file_name: <canonical URL>, total: 0,
  status: 'reading', visit_status: 'want_to_go', tag_ids: [tagId],
  meta: { phase: 'reading', shortcode } }`.
- **Response:** **`202 { jobId }`**. `500` with the error text when the tag or the
  job insert fails.
- **Side effects (after the response):** `after(async () => { await runInstagramImportJob(...); await flushLangfuse(); })`
  on `createServiceClient()` — monthly AI budget check, HikerAPI + Gemini + Google
  Text Search through `analyzeInstagramPost`, `trackUsage` / `trackAiUsage`,
  `import_job_items` INSERT, tag + note on already-saved places
  (`attachInstagramSource`), `import_jobs` UPDATE (`meta`, `total`, `status`,
  `finished_at`), then `kickDrain` when places were queued. Every write is keyed
  to the job id or the session's `user_id`; place ids come from a
  `user_id`-filtered lookup (`findExisting`).
- **Errors after 202** land on the job, not the response: `meta.phase = 'failed'`
  with `meta.error` ∈ `budget_exceeded`, `invalid_url`, `post_unavailable`,
  `not_configured`, `service_error`.

### `GET /api/instagram/import/[id]`

- **Source:** `src/app/api/instagram/import/[id]/route.ts`
- **Auth:** required. Runs on the **session client** — RLS limits the job and its
  items to their owner — and also filters `user_id` and `kind = 'instagram'`.
- **DB:** `import_jobs` SELECT (`id, file_name, created_at, meta, tag_ids`);
  `import_job_items` SELECT (`id, stage, reason, place_id, payload, updated_at`,
  oldest first); `places` SELECT for the items' `place_id`s (`id, name, address,
  location`, `google_data->>photo_storage_url`), location parsed with
  `parsePostgisPoint`.
- **Response:** `404 { error: "Not found" }`, or `200 InstagramImportView`
  (`src/lib/instagram/types.ts`):

  ```ts
  {
    id: string;
    phase: "reading" | "adding" | "done" | "failed";
    error: "invalid_url" | "post_unavailable" | "budget_exceeded"
         | "not_configured" | "service_error" | "stalled" | null;
    postUrl: string;                       // import_jobs.file_name
    tagId: string | null;                  // import_jobs.tag_ids[0] — the "instagram" tag
    post: { owner, ownerFullName, caption, locationName } | null;  // meta.post
    createdAt: string;
    items: {
      id: string;
      status: "pending" | "added" | "already_saved" | "skipped" | "failed" | "removed";
      name: string;                        // place name → payload.name → label
      reason: string | null;               // skipped / failed only
      evidence: string[];                  // "Tagged in photo", "Phone matches", …
      sameNameCount: number;
      searchName: string;                  // prefill for the map search
      options: { id, name, address, lat, lng }[];  // skipped items only; the stored CID is not sent
      near: { lat, lng } | null;           // payload.instagram.near
      photoPending: boolean;               // stage "photo", updated_at < 10 min ago
      place: { id, name, address, lat, lng, photoUrl } | null;
    }[];
  }
  ```

- **Computed phase** — derived from the stored phase and the items. The drain's
  `finalizeJobs` writes `done` when it closes the job and a pick writes `adding`,
  but the items decide: stored `reading` older than 3 min (`STALL_MS`) →
  `failed` + `stalled`; stored `adding` or `done` → `adding` while any item is
  still at stage `import`, else `done`; `failed` passes through.
- **Item status** (`statusOf`): `import` → `pending`; `photo` / `reviews` /
  `profile` / `done` → `added`, or `removed` once the place is deleted
  (`place_id` is `on delete set null`); `skipped` with reason `Already exists` →
  `already_saved` (or `removed`); `failed` → `failed`; any other `skipped` →
  `skipped`.
- **`photoPending`** — the item is at stage `photo` and its `updated_at`, which
  the drain stamps on every stage change, is less than 10 minutes old
  (`PHOTO_WAIT_MS`). A photo that never arrives stops counting as pending, so
  the client's photo polling ends on its own.
- **Notes:** polled by [[../../03-frontend/hooks/use-instagram-import]] every
  1.5 s while the phase is `reading` or `adding`, then every 3 s while any item
  has `photoPending` (the map page's background watcher skips that part).

### `POST /api/instagram/import/[id]/pick`

- **Source:** `src/app/api/instagram/import/[id]/pick/route.ts`
- **Auth:** required (`supabase.auth.getUser()` → 401).
- **Body:** `{ itemId: string (uuid), placeId: string (1–300 chars) }` — Zod
  `BodySchema`; `placeId` is a Google place id from the item's options. 400
  `Invalid body` otherwise.
- **Reads (session client):** the job, filtered by `id`, the session's
  `user_id` and `kind = 'instagram'` (`id, file_name, tag_ids, meta, total`),
  and the item by `itemId` within that job (`id, stage, reason, payload`). RLS
  proves both belong to the user; either missing → `404 { error: "Not found" }`.
- **Guard:** `409 { error: "This place can't be picked for that item." }` unless
  the item is at stage `skipped`, its reason is not `Already exists`, it has
  `payload.instagram`, and `placeId` matches one of
  `payload.instagram.options`. Only a place the import itself offered can be
  picked.
- **Payload written** for the item, from the option: `name`, `address`, `lat`,
  `lng`, `googleMapsUrl: https://maps.google.com/?cid=<cid>`, `note` = the post
  URL (`import_jobs.file_name`), and `instagram` = the stored info with
  `rule: "picked"`, `evidence: ["Picked by you"]`, `skip: null` and `options`
  dropped (`near` and `searchName` stay).
- **Already saved** (`findExisting` by place id, then CID, on the user's
  places): `attachInstagramSource` upserts the job's `tag_ids` on that place and
  appends the post URL to its notes once; the item is updated to
  `stage 'skipped'`, `reason 'Already exists'`, `place_id` = that place, the
  payload above, a fresh `updated_at` — guarded by `stage = 'skipped'`; then the
  job's `total + 1`, as for the places the first read found already saved.
  **Response:** `200 { status: "already_saved" }`.
- **Otherwise — back into the queue:** the item is updated to `stage 'import'`,
  `reason null`, `place_id null`, the payload above, `attempts 0`,
  `claimed_at null`, a fresh `updated_at`, guarded by `stage = 'skipped'` so a
  double tap queues it once (no row matched → `409 { error: "Already picked." }`).
  Then the job: `status 'running'` (the claim only reads running jobs),
  `finished_at null`, `meta.phase 'adding'`, `total + 1`; and `kickDrain` with
  the request's origin. **Response:** `200 { status: "pending" }`.
- **DB clients:** the lookup and the writes run on `createServiceClient()` —
  `import_job_items` has no UPDATE policy — keyed to the item and job ids the
  session client has just read, and to the session's `user_id`.
- **Notes:** no external call and nothing billed here; the drain later spends the
  usual DataForSEO business-info lookup (by CID) and enrichment for the place.
  Called by `usePickInstagramPlace` ([[../../03-frontend/hooks/use-instagram-import]]).

## Shared concerns

- **Two clients on purpose.** Everything a session may do — create its own job,
  read its own job and items — runs on the cookie client under RLS. The background
  job uses the service role because `import_job_items` has no INSERT policy (stage
  is queue state; see [[../schema/import-jobs#rls]]) and because it runs after the
  response, outside the request's cookie context. The pick route reads on the
  cookie client first, then moves the item on the service role — there is no
  UPDATE policy either, and the guard (a stored option, a `skipped` item) is
  what limits a session to the transition the import offered.
- **Not an `/api/ai/*` route.** It spends a Gemini call, gated like the AI
  routes: the server's Gemini key, `profiles.ai_features_enabled`, and the monthly
  `instagram` budget (300 posts per user). See [[../../04-integrations/gemini]].
- **Places are not created here.** New places come out of the drain with
  `source = 'instagram'` — a picked place too; this group only writes jobs,
  items, the tag, and the tag + note on places the user already had.
- **Removing a wrong place** goes through the ordinary
  `DELETE /api/places/[id]` (see [[places]]) — it deletes the place.

## Open questions

- **No cancel.** `PATCH /api/places/import-jobs/[id]` would cancel an Instagram
  job too (it does not check `kind`), but nothing in the UI offers it.
