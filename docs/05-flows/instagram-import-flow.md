---
title: Instagram Import Flow
type: flow
domain: places
version: 1.0.0
last_updated: 16.10.2026
status: stable
sources:
  - src/components/map/map-content.tsx
  - src/components/places/add-place-dialog.tsx
  - src/components/places/instagram-import-panel.tsx
  - src/lib/hooks/use-instagram-import.ts
  - src/app/api/instagram/import/route.ts
  - src/app/api/instagram/import/[id]/route.ts
  - src/lib/instagram/url.ts
  - src/lib/instagram/types.ts
  - src/lib/instagram/import-job.ts
  - src/lib/instagram/analyze.ts
  - src/lib/instagram/read-post.ts
  - src/lib/instagram/resolve.ts
  - src/lib/instagram/normalize.ts
  - src/lib/instagram/maps-link.ts
  - src/lib/instagram/provenance.ts
  - src/lib/hikerapi/client.ts
  - src/lib/google/place-candidates.ts
  - src/lib/import/kick-drain.ts
  - src/lib/import/process-place.ts
  - src/app/api/cron/drain-imports/route.ts
  - src/lib/ai/track-usage.ts
  - src/lib/google/track-usage.ts
  - scripts/instagram-eval/run.ts
  - scripts/instagram-eval/labels.json
related:
  - "[[place-import-flow]]"
  - "[[share-target-flow]]"
  - "[[manual-place-create-flow]]"
  - "[[place-search-flow]]"
  - "[[ai-enrichment-flow]]"
  - "[[../02-backend/api-routes/instagram]]"
  - "[[../02-backend/schema/import-jobs]]"
  - "[[../02-backend/schema/places]]"
  - "[[../03-frontend/hooks/use-instagram-import]]"
  - "[[../03-frontend/components/places#instagramimportpanel]]"
  - "[[../04-integrations/hikerapi]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/gemini]]"
tags:
  - instagram
  - import
  - queue
---

# Instagram Import Flow

A user shares an Instagram post or reel; every venue the post features that can
be pinned **on evidence** lands on their map — no confirmation step. The server
reads the post, decides deterministically which Google place each venue is, and
hands the new places to the same durable queue that runs Takeout imports, so
they get the full photo → reviews → AI-profile enrichment. Venues that cannot be
pinned are listed with the reason and a one-tap hand-off to the map search.

**End state.** New places: `source = 'instagram'`, visit status `want_to_go`,
the user's `instagram` tag, the canonical post URL as the note. Places the user
already had: the tag added and the post URL appended to their notes (once).

> **Deployment state (16.10.2026).** The code is on the `feat/instagram-import`
> branch, not merged. Its DB migration was applied to the live database on
> 16.10.2026 — see [[../02-backend/schema/import-jobs#instagram-migration]].
> `HIKERAPI_KEY` has to be set in the Vercel environment for it to run there.

## Trigger

- **iPhone:** the iOS Shortcut "Add to MapOrganiser" opens
  `/map?add=<url-encoded link>`. `MapContent` opens the Add Place dialog with
  that URL as `initialUrl`; when it is an Instagram post/reel link the dialog
  switches to Instagram mode.
- **Paste:** an Instagram link pasted into the Add Place dialog (map FAB or
  header button) does the same.
- **Not** the PWA share sheet: `/api/share-target` only forwards Google Maps
  links (its regex), so an Instagram link shared that way lands on plain `/map`.
  See [[share-target-flow]].

A link counts as a post when `parseInstagramPostUrl` (`src/lib/instagram/url.ts`)
finds `instagram.com/[<user>/](p|reel|reels|tv)/<shortcode>` (www./m. hosts
included) in any whitespace-separated token — share sheets sometimes wrap the
link in text. The result is canonicalised to
`https://www.instagram.com/p/<shortcode>/`, which is what HikerAPI is asked for,
what the job stores in `file_name`, and what becomes the note.

## Steps

```mermaid
sequenceDiagram
  participant D as Add Place dialog (InstagramImportPanel)
  participant R as POST /api/instagram/import
  participant J as after() job (runInstagramImportJob)
  participant X as HikerAPI / Gemini / Google Text Search
  participant Q as drain-imports (queue)
  D->>R: { url }
  R-->>D: 202 { jobId }  (or 200 { jobId, reused: true })
  R->>J: after(): read the post
  J->>X: post + profiles → one Gemini read → candidate searches
  J->>Q: import_job_items (stage import / skipped) + kickDrain
  Q->>Q: import → photo → reviews → profile (same as Takeout)
  loop every 1.5 s while reading / adding
    D->>R: GET /api/instagram/import/[id]
  end
```

### A. Dialog

1. `AddPlaceDialog` sees an Instagram URL — in `initialUrl` or via `handlePaste`
   — and renders [[../03-frontend/components/places#instagramimportpanel|`InstagramImportPanel`]]
   instead of the parse-link preview. `parse-link` is never called for it.
2. The panel starts the job once per URL through
   [[../03-frontend/hooks/use-instagram-import|`useStartInstagramImport`]]
   (`POST /api/instagram/import`; a ref guards React's development double
   mount). On `/map` the returned id goes up to `MapContent`, which writes
   `?ig=<jobId>` into the URL with `router.replace`, keeping every other param
   (the filters).

### B. Request — `POST /api/instagram/import`

3. Gates, in order: session (401) → body `{ url }` (Zod, 400) → it is an
   Instagram post link (400) → `HIKERAPI_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`
   set (503) → the user has a Google Places key via `getUserApiKeys` — their own
   key, or `GOOGLE_PLACES_API_KEY` for admins (400 "Instagram import needs a
   Google Places API key. Add one in Settings.").
4. **Reuse.** The user's newest `kind = 'instagram'` job for the same canonical
   URL, created in the last 10 minutes and whose stored phase is not `failed`,
   is returned as `200 { jobId, reused: true }`. The iOS Shortcut can fire twice.
5. `ensureInstagramTag` finds the user's `instagram` tag (any letter case) or
   creates it with colour `#E4405F`; a lost race with a parallel import falls
   back to the row the unique `(user_id, name)` index kept.
6. Insert the job on the session client: `kind 'instagram'`, `file_name` = the
   canonical URL, `total 0`, **`status 'reading'`**, `visit_status 'want_to_go'`,
   `tag_ids [tagId]`, `meta { phase: 'reading', shortcode }`. `reading` rather
   than `running` because the drain's `finalizeJobs` closes any `running` job
   that holds no active items — and this one has none until the post is read.
7. Answer `202 { jobId }`; `after()` then runs `runInstagramImportJob` on the
   service-role client. The route exports `maxDuration = 120`.

### C. Background job — `runInstagramImportJob` (`src/lib/instagram/import-job.ts`)

8. `checkAiBudget("instagram")` — 300 posts per user per calendar month (UTC).
   Over it, the job fails with `budget_exceeded` before any paid call.
9. `analyzeInstagramPost` (`src/lib/instagram/analyze.ts`), detailed in
   [[#how-a-venue-is-pinned]]: HikerAPI → one Gemini read → Google Text Search →
   deterministic rules. It writes nothing.
10. Usage: each HikerAPI request → `hikerapi_request`, each Text Search →
    `text_search_enterprise` (both in a `finally`, so a failed analysis is still
    counted), then one `ai_instagram_read` once the analysis has succeeded.
11. One `import_job_items` row per decision (service-role insert):

    | Decision | `stage` | `reason` | `place_id` | `payload` |
    |---|---|---|---|---|
    | Pinned, not yet saved | `import` | — | — | `name`, `address`, `lat`, `lng`, `googleMapsUrl` = `https://maps.google.com/?cid=<cid>` (or `?q=place_id:<id>` without a CID), `note` = post URL, `instagram` (below) |
    | Pinned, already saved (`findExisting` by place_id / CID) | `skipped` | `Already exists` | the existing place | same as above; `attachInstagramSource` has already added the tag + note |
    | Not pinned: `chain_branch_unknown`, `no_evidence`, `ambiguous`, `closed` | `skipped` | the code | — | `name`, `instagram` |
    | `not_a_venue`, `not_featured`, `unverified_name` | not written | | | |

    `payload.instagram` (`InstagramItemInfo`): the candidate label, its sources,
    the rule that accepted it, human evidence labels ("Tagged in photo",
    "Phone matches", "Only one nearby", …), the skip code, how many same-name
    places were seen, and `searchName` — the prefill for the manual search.
12. Close the reading phase: `meta = { phase: 'adding' | 'done', shortcode,
    post: { owner, ownerFullName, caption (≤ 280 chars), locationName } }`,
    `total` = new + already-saved places, `status 'running'` when there is
    something to import (then `kickDrain`), else `status 'done'` + `finished_at`.
13. Any throw → `meta = { phase: 'failed', shortcode, error }`, `status 'done'`;
    `error` is `invalid_url`, `post_unavailable`, `not_configured` or
    `service_error`.

### D. Queue — `GET /api/cron/drain-imports`

14. The `import` stage runs `importPlace` exactly as for a Takeout row, with the
    job's defaults: visit status `want_to_go`, the `instagram` tag, and
    `source: "instagram"` because the job's `kind` is `instagram`. The
    `?cid=` URL resolves to a `cid:` DataForSEO business-info lookup; the place is
    inserted under Google's display name with the post URL as `notes`.
15. `photo` → `reviews` → `profile` follow as for any import — see
    [[place-import-flow]] and [[ai-enrichment-flow]].
16. If the place appeared between the analysis and the drain, `importPlace`
    returns `skipped / Already exists`; the drain then runs
    `attachInstagramSource` on the existing row itself.

### E. Progress and result

17. [[../03-frontend/hooks/use-instagram-import|`useInstagramImport`]] polls
    `GET /api/instagram/import/[id]` every 1.5 s while the phase is `reading` or
    `adding` (or nothing has loaded yet).
18. The route computes what the dialog shows — the stored `meta.phase` is not
    updated by the drain:
    - stored `reading` older than 3 min → `failed` / `stalled` (the background run
      was lost);
    - stored `adding` or `done` → `adding` while any item is still at stage
      `import`, else `done`.
    - Items: `import` → `pending`; `photo`/`reviews`/`profile`/`done` → `added`
      (`removed` when its place has since been deleted); `skipped` +
      `Already exists` → `already_saved`; `failed` → `failed`; other `skipped` →
      `skipped`.
19. The panel invalidates `["places"]` as items land, so pins appear during the
    run. Finished, it shows a single-place card or a list; each added place has
    **Remove** (`DELETE /api/places/[id]` — deletes the place), and on `/map`
    each unpinned venue has a **Pick branch** (chain) or **Search** button.

### F. Leaving and coming back (map page)

20. **Close mid-way** ("Continue in background" or ✕) → `closeAddDialog` drops
    `?ig`; if the last phase seen was not `done`/`failed`, `MapContent` keeps
    polling that job in the background and toasts once when it ends —
    "N places added from Instagram", "No new places from that Instagram post" or
    "Couldn't add from that Instagram post" — with a **View** action that
    reopens the dialog on the job.
21. **Refresh** with `?ig=<jobId>` → `MapContent` reopens the dialog in
    Instagram mode for that job; no post URL is needed.
22. **Show on map** → the dialog closes and `MapView.fitToCoords` frames every
    added and already-saved place (one place: fly to zoom 16; several: fit bounds,
    padding 80, max zoom 15).
23. **Pick branch / Search** → the dialog closes and `SearchBoxHandle.search`
    puts the venue name into the map search box with the suggestions open — the
    user continues in [[place-search-flow]].

Steps 20–23 exist only on `/map`. The header's and `SimilarPlaces`' dialogs
pass none of these callbacks: the import still runs and reports in the dialog,
but there is no `?ig`, no completion toast after closing, no Show on map and no
search hand-off.

## How a venue is pinned

### 1. Read the post (HikerAPI)

`getMediaByUrl` for the post, plus `getMediaUsertags` for a reel whose v1 answer
carried no usertags. Accounts = tagged (photo and every carousel slide) ∪
coauthors ∪ caption @mentions ∪ **the owner, always** — on a venue's own post,
the owner's profile carries the phone, website or coordinates that pin it. One
profile read per account, five in parallel. See [[../04-integrations/hikerapi]].

### 2. Classify (one Gemini call)

`readPost` (`src/lib/instagram/read-post.ts`): `gemini-3-flash-preview`,
`Output.object(PostReadingSchema)`, `thinkingLevel: "low"`; the prompt carries the
caption (≤ 3,000 chars), the location tag, the owner and each account with its
profile (bio ≤ 200 chars). The system prompt states that precision matters more
than recall and defines "featured" (shown or recommended as a place to go — not
tour stops, sub-spaces of another featured venue, orientation landmarks or
credited accounts).

Per account it returns a `role` — `venue`, `venue_brand_multi` (a brand running
several locations), `person`, `media_or_creator`, `brand_or_product`, `other` —
plus `featured`, `branch_hint`, `address_in_post`, `venue_name` and a short
evidence quote. For the post: `location_tag_is_specific_venue`, `text_venues`
(venues named in the caption without an account) and `area` {neighbourhood,
district, city, country}. **The model never chooses a Google place.**

### 3. Verify the model's quotes

Nothing the model returns is trusted unless the post says it
(`analyze.ts`, `quoted` / `verified` / `fromPost`):

- a branch hint, area or city counts only if its words occur in the post text
  (caption + location tag + bios) or inside one of the post's usernames;
- an address only if at least 80 % of its words occur;
- a plain-text venue only if its name is in the caption itself
  (`unverified_name` otherwise);
- an area may vouch for "only one nearby" (`fromPost`) only when it is written in
  the caption, the location tag or a username — **never only in a bio**, because
  bios name a brand's home branch.

### 4. Build candidates

- Each account the model calls `venue` / `venue_brand_multi` and featured
  (others are dropped as `not_a_venue` / `not_featured`; a non-venue owner is
  dropped silently).
- The location tag, when the model says it names one specific venue: merged into
  the account candidate it matches (name ≥ 0.6, or within 150 m), else its own
  candidate.
- Each verified plain-text venue: merged into a matching candidate
  (name ≥ 0.7), lending it the post's address and area; otherwise its own
  candidate if the model marked it featured (`not_featured` if not).
- **Area:** the verified hints (branch hint → neighbourhood → district) are
  geocoded with one Text Search each, in that order, until one comes back as an
  area: the top hit must not be an establishment and must carry an area type —
  radius 2 km (neighbourhood), 2–2.5 km (sublocality, colloquial area), 1.5 km
  (route), 2.5–7 km (admin levels 4–2).
- **The venue's own Maps link** in its profile website or bio (`maps.app.goo.gl`,
  `goo.gl/maps`, `g.page`, `google.*/maps`, `maps.google.*`) is followed once
  (plain fetch, redirects) to read its CID, place id, name and coordinates
  (`src/lib/instagram/maps-link.ts`).

### 5. Search Google

`searchPlaceCandidates` (`src/lib/google/place-candidates.ts`) — Places API (New)
Text Search with an **Enterprise** field mask (`websiteUri` and the phone fields
are the evidence), 5 results per query (20 for the city-wide one), a location-bias
circle whenever a coordinate is known. `resolveCandidate` tries the candidate's
queries in order — Maps-link name near its pin, the post's address, name near the
profile / tag / area coordinates, name + profile address, name + branch hint, the
city-wide query, alternative names — and stops as soon as a place is decided,
except that a `unique_in_area` decision waits until every remaining query,
the city-wide one included, has run.

### 6. Decide — `src/lib/instagram/resolve.ts`

Evidence per Google candidate (`evidenceFor`): same phone (last 9 digits); same
website (registrable domain; link-in-bio hubs such as linktr.ee or wa.me never
count); Google's website is the account's own Instagram URL; the venue's Maps link
names this CID / place id; street address match (same house number and a shared
street word) against the profile/tag address or the post's quoted address; the
verified branch hint inside Google's address; distance from the profile
coordinates and from the location tag; inside the area; name similarity 0–1
(Turkish-aware, generic words like "cafe" or "istanbul" ignored); permanently
closed.

| Group | Means | Signals |
|---|---|---|
| pin | names the exact spot | Maps link, address match, post address match, branch hint |
| location | puts it at this spot | pin, or ≤ 100 m from the profile coordinates, or ≤ 120 m from the location tag |
| identity | it is this business — but every branch of a chain shares it | phone, website, Instagram handle, Maps link |

| Candidate | Accepted by | When |
|---|---|---|
| account, single venue | `evidence` | name ≥ 0.5 **and** identity or location evidence |
| account, `venue_brand_multi` | `evidence` | name ≥ 0.5 **and** location evidence — identity alone is not enough for a chain |
| account | `near` | name ≥ 0.85 and ≤ 300 m from the profile coordinates or the location tag |
| account (not a chain), plain-text venue | `unique_in_area` | the area is from the post itself (not only a bio), name ≥ 0.9, inside the area, a distinctive name (≥ 5 characters once spaces are removed), no same-name place elsewhere (> 150 m away and a different address) — decided only after the city-wide query |
| location tag | `location_tag` | name ≥ 0.6 and ≤ 150 m from the tag, or an address match |
| plain-text venue | `post_address` | name ≥ 0.6 and the post's own address matches |

When several places pass: keep those with pin evidence, then those with location
evidence; **duplicate Google listings** (all names ≥ 0.95 within 60 m) → the most
rated, if it has at least 3× the runner-up's ratings; **sub-venues of one
building** (within 150 m or the same address) → the best-named one, if it leads
by ≥ 0.095. Still several → skip as `ambiguous` (`chain_branch_unknown` for a
chain). An account accepted without location evidence that has a same-name place
elsewhere → `chain_branch_unknown`. A permanently closed pick → `closed`.
Nothing accepted → `no_evidence` (`chain_branch_unknown` for a chain).

Finally, one decision per Google place: a second candidate that resolves to the
same place only adds its sources.

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| B | `{ url }` | 1 `import_jobs` row (`kind 'instagram'`, `status 'reading'`), the `instagram` tag if new |
| C | the post URL | `import_job_items` rows; `meta.post`; tag + note on already-saved places; `api_usage` rows (`hikerapi_request`, `text_search_enterprise`, `ai_instagram_read`) |
| D | `import` items | `places` rows (`source 'instagram'`) + `place_tags`, then photo, reviews, profile |
| E | job id | `InstagramImportView` — phase, error, post summary, item views with place coordinates and photo |

## Measured quality

Regression set `scripts/instagram-eval/labels.json` — 35 hand-labelled public
posts: 25 the rules were tuned on (`dev`, 34 venues to add) and 10 never seen
while tuning (`holdout`, 9 venues to add). `npm run eval:instagram` runs the
production analyzer and writes nothing to the database; it exits 1 on any wrong
or spurious place. Measured 16.10.2026 with 3 independent Gemini samples:

- **Prototype (rules frozen, before the port):** 0 wrong places in all three
  samples; recall 85–88 % on `dev`, 7 / 9 on `holdout`.
- **Production code (`npm run eval:instagram`, three full runs):** **0 wrong or
  spurious places** in every run; recall **37–38 / 43 (86–88 %)** — `dev`
  29–30 / 34, `holdout` 8 / 9. Reading the owner's profile on every post fixed
  the venue's-own-post miss (Barcelona Tapas, `holdout`).
- Per post: ≈ 4 HikerAPI requests (the owner profile is the extra one),
  ≈ 3 Google Text Searches, 1 Gemini call.

Remaining misses, by reason (the runner prints them):

- chain branches that only the photos identify (`chain_branch_unknown`) — 3 in
  the study-café list;
- Walter's Coffee: the only area hint is the brand's bio ("Moda") while the post
  shows its other branch — skipped (`no_evidence`), which is the right outcome;
- a café inside a cultural complex: the model marks the café not featured and
  the complex (a location tag) is added instead — labelled `optional`;
- run-to-run: one list venue occasionally drops out of a run (Gemini variance);
  each was added in the other runs and in isolated re-runs.

## Cost per post

| Call | Count | SKU | Price |
|---|---|---|---|
| HikerAPI | ≈ 4 | `hikerapi_request` | $1 / 1,000 |
| Google Text Search (Enterprise) | ≈ 3 | `text_search_enterprise` | $35 / 1,000 after 1,000 free a month — on the user's Google key |
| Gemini read | 1 | `ai_instagram_read` | $1.5 / 1,000 (≈ 1.2k in / 0.3k out tokens) |
| DataForSEO + profile, per place added | as for any import | see [[place-import-flow]] | |

The monthly `instagram` budget (300 posts per user) bounds the first three.

## Failure modes

| Where | Symptom | Cause / behaviour |
|---|---|---|
| B | 400 "That isn't an Instagram post or reel link." | Profile, story or other non-post URL. |
| B | 503 "Instagram import isn't set up on this server." | `HIKERAPI_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` missing. |
| B | 400 "Instagram import reads the post with AI. Turn on AI features in Settings." | `profiles.ai_features_enabled` is off. |
| B | 400 "…needs a Google Places API key. Add one in Settings." | No per-user key and not an admin. The `google_places_enabled` toggle (it scopes Maps-link lookups) is deliberately not consulted — see Open questions. |
| B | 500 with the database error text | The tag or the job insert failed. |
| C | "You've used this month's Instagram imports." | `budget_exceeded`; no Try again. |
| C | "Couldn't open this post. It may be private or deleted." | `post_unavailable` (HikerAPI 404). |
| C | "Something went wrong while reading this post." | `service_error`: HikerAPI still failing after its retries, a Google Text Search failing twice, the Gemini call failing, or the item insert failing. Try again starts a new job. |
| C | "This took too long and stopped." | `stalled`: still `reading` after 3 min — the `after()` run died (e.g. hit `maxDuration`). Try again starts a new job (the reuse check skips stalled jobs). |
| C | "No places in this post" | Nothing could be pinned. When no skipped venue is listed either, the dialog says no account, location tag or address points to one specific place; on `/map`, "Search manually" opens the map search. |
| D | An item ends `failed` | As in [[place-import-flow]] — DataForSEO / insert errors, 3 failed attempts. |
| D | Items stay "Adding…" | The drain never runs: `CRON_SECRET` unset (the kick no-ops; locally there is no cron at all) or no DataForSEO credentials. |
| E | "Couldn't load this import." | `GET` 404 (not this user's job, or not an Instagram job). The hook keeps polling while the dialog is open. |

## Known limits

- **Chains pinned only by photos** are skipped as `chain_branch_unknown`, with
  "N branches · the post doesn't say which" and **Pick branch**.
- **A place picked through Pick branch / Search** is saved by the normal search
  flow (`source 'mapbox_search'`); its form starts with the post link as the note
  and the `instagram` tag selected (`SearchResultPanel` `prefill`), both editable.
- **Gemini output varies between runs.** The precision guard held in every run;
  recall moves by about one place.
- **Telemetry.** The read emits `ai.instagram-read-post` spans
  (`experimental_telemetry`, userId + shortcode); the `after()` run ends with
  `flushLangfuse` like the other LLM routes — see [[observability-flow]].
- **A profile read that fails** is retried once and logged
  (`[instagram] profile @… failed`); a missing profile only weakens the evidence.

## Related code

- `src/lib/instagram/url.ts` — `parseInstagramPostUrl`, `isInstagramPostUrl` (client-safe).
- `src/lib/instagram/types.ts` — job meta, item info and the dialog's view shapes (client-safe).
- `src/app/api/instagram/import/route.ts` — create / reuse a job, `after()`.
- `src/app/api/instagram/import/[id]/route.ts` — the dialog's progress view.
- `src/lib/instagram/import-job.ts` — `runInstagramImportJob`: budget, usage, item rows, finish.
- `src/lib/instagram/analyze.ts` — `analyzeInstagramPost`: accounts, verification, candidates, area.
- `src/lib/instagram/read-post.ts` — the Gemini read and `PostReadingSchema`.
- `src/lib/instagram/resolve.ts` — evidence, acceptance rules, tie-breaks, query plan.
- `src/lib/instagram/normalize.ts` — Turkish-aware name, phone, website, address and distance helpers.
- `src/lib/instagram/maps-link.ts` — find and follow a venue's own Maps link.
- `src/lib/instagram/provenance.ts` — `ensureInstagramTag`, `attachInstagramSource`.
- `src/lib/hikerapi/client.ts` — see [[../04-integrations/hikerapi]].
- `src/lib/google/place-candidates.ts` — Text Search (Enterprise field mask).
- `src/lib/import/kick-drain.ts` — shared with the Takeout import.
- `src/app/api/cron/drain-imports/route.ts`, `src/lib/import/process-place.ts` — the queue.
- `src/lib/hooks/use-instagram-import.ts` — start + poll.
- `src/components/places/instagram-import-panel.tsx`, `src/components/places/add-place-dialog.tsx` — the UI.
- `src/components/map/map-content.tsx` — `?ig`, background watcher, toasts, hand-offs; `map-view.tsx#fitToCoords`; `search-box.tsx#SearchBoxHandle`.
- `scripts/instagram-eval/` — `run.ts`, `labels.json`, `README.md`, `tsconfig.json`.

## Open questions

- **Google Places toggle.** The import uses Google Text Search even when the
  user's `google_places_enabled` toggle ("Use Google for fast place lookup when
  adding links") is off — the evidence rules were built and measured on Google
  results. Whether the toggle should also govern this import (or a DataForSEO
  candidate search should exist) is the owner's call.
- **PWA share sheet.** `/api/share-target` still forwards only Google Maps links;
  Instagram arrives through the iOS Shortcut or a pasted link, by decision.
