---
title: HikerAPI (Instagram data)
type: integration
domain: integrations
version: 1.0.0
last_updated: 16.10.2026
status: stable
sources:
  - src/lib/hikerapi/client.ts
  - src/lib/instagram/analyze.ts
  - src/lib/instagram/import-job.ts
  - src/lib/google/track-usage.ts
  - src/app/api/instagram/import/route.ts
  - scripts/instagram-eval/run.ts
related:
  - "[[_README]]"
  - "[[google-places]]"
  - "[[gemini]]"
  - "[[../05-flows/instagram-import-flow]]"
  - "[[../02-backend/api-routes/instagram]]"
  - "[[../02-backend/schema/api_usage]]"
  - "[[../06-ops/env-vars]]"
tags:
  - instagram
  - import
---

# HikerAPI

> Reads an Instagram post and the profiles of the accounts it points at, so the
> [[../05-flows/instagram-import-flow|Instagram import]] can work out which
> venues the post is about. Read-only; nothing from HikerAPI is stored except a
> four-field post summary.

## Account & access

- **Provider:** [HikerAPI](https://hikerapi.com) — a hosted Instagram data API.
- **Account:** one system-level key for the whole app, not a per-user key. Users
  never see or configure it.
- **Plan:** pay-as-you-go, priced in the code at **$1 per 1,000 requests**
  (`SKU_CONFIG.hikerapi_request`, no free tier).
- **Auth:** header `x-access-key: <HIKERAPI_KEY>` on every request.
  Base URL `https://api.hikerapi.com`.

## NPM packages

None — plain `fetch` from `src/lib/hikerapi/client.ts` (`import "server-only"`).

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `HIKERAPI_KEY` | **server only** | `src/lib/hikerapi/client.ts#get` (every call). `POST /api/instagram/import` checks it is set before creating a job and answers **503** "Instagram import isn't set up on this server." without it. Also read by `npm run eval:instagram` from `.env.local`. |

## What we call

Every function below is **one billed request**. Responses are parsed from
`unknown` into small shapes (`IgMedia`, `IgLocation`, `IgAccountRef`,
`IgProfile`); everything else in the payload is dropped.

| Function | Endpoint | What we keep |
|---|---|---|
| `getMediaByUrl(canonicalUrl)` | `GET /v1/media/by/url?url=` | Media pk + shortcode, media type (1 photo, 2 video/reel, 8 carousel), caption, owner, location tag (name, address, city, lat/lng, phone, website), usertags of the post **and** every carousel slide (deduplicated), coauthors, `taken_at`. |
| `getMediaUsertags(mediaPk)` | `GET /gql/media/usertags?media_ids=` | Usertags of a video/reel. The v1 media call leaves them out for videos, so `analyzeInstagramPost` makes this call only when `mediaType === 2` and v1 returned no usertags. |
| `getProfileById(pk)` | `GET /v1/user/by/id?id=` | Full name, business flag, category, biography, external URL, phone, street address, city, coordinates. |
| `getProfileByUsername(username)` | `GET /v1/user/by/username?username=` | Same shape — used for caption @mentions, which carry no pk. |

Parsing details that matter downstream:

- Usernames are lower-cased; they are the account key in `analyze.ts`.
- A profile at `0,0` has no coordinates (`latitude`/`longitude` become `null`).
- Phone = `contact_phone_number`, else `public_phone_country_code` + `public_phone_number`.
- Category = `category` → `category_name` → `business_category_name`, first non-empty.

## Where it's used

Only by the Instagram import, inside `analyzeInstagramPost`
(`src/lib/instagram/analyze.ts`), which runs in the background job of
`POST /api/instagram/import` and in the eval script:

1. One `getMediaByUrl` for the post.
2. One `getMediaUsertags` when the post is a reel whose v1 answer had no usertags.
3. One profile read per account the post points at — tagged, coauthor,
   @mentioned in the caption, **and the owner, always** — by pk when known,
   otherwise by username. Five at a time (`PROFILE_CONCURRENCY`).

A failed profile read is swallowed (`profile = null`): it only removes evidence
(no phone, website, address or coordinates for that account), so the account is
more likely to be skipped, never more likely to be mis-pinned.

## Cost & limits

- **$1 / 1,000 requests**, tracked as SKU `hikerapi_request` in
  [[../02-backend/schema/api_usage]] — one `trackUsage` per call, written in a
  `finally` so calls made by a failed import are still counted.
- **≈ 4 requests per post** (143 for the 35-post eval set, 16.10.2026): the
  post, a reel's usertags, and one profile per tagged / coauthor / mentioned
  account plus the owner. A 10-venue list post takes ~12.
- **Bounded by the AI budget.** Every import burns one unit of the monthly
  `instagram` budget (300 posts per user, `AI_MONTHLY_INSTAGRAM_CAP`), which
  therefore also caps HikerAPI use — at ≈ 4 requests per post, roughly 1,200
  requests (≈ $1.20) per user per month at the cap.
- **Tracking is an approximation of the bill.** The client's header comment
  records that HikerAPI bills every 2xx/4xx answer and not 5xx. We count one unit
  per logical call before it is made, so a call retried after a `429` is billed
  twice but counted once, and a call that dies at network level is counted
  though never billed.
- No rate-limit handling beyond the retry on `429`.

## Failure modes

| Symptom | Cause | What happens |
|---|---|---|
| `POST /api/instagram/import` → 503 | `HIKERAPI_KEY` unset | No job is created. (A key that disappears while a job runs surfaces as job error `not_configured`.) |
| Dialog: "Couldn't open this post. It may be private or deleted." | `v1/media/by/url` → `404` (→ `null`) | `InstagramImportError("post_unavailable")`; the job fails with no items. |
| Dialog: "Something went wrong while reading this post." | `429` / `5xx` / timeout still failing after 2 retries, or another non-2xx | `HikerApiError` propagates; job error `service_error`. |
| Fewer venues found than expected | A profile read failed, or a response shape changed | The parsers return `null` / empty arrays instead of throwing — the reel-usertags path reads `data["1$multifetch__XDTMediaDict(ids:$media_ids)"][0].node.usertags.in`, which is brittle by nature. The import degrades to fewer candidates. |

Transport (`get` in `client.ts`): 20 s timeout per request, up to **2 retries**
on `429`, `5xx` and network errors with `400 ms × attempt` back-off; `404`
returns `null`; any other non-2xx throws immediately.

## Replacement strategy

`src/lib/hikerapi/client.ts` is the only module that knows HikerAPI exists.
`analyze.ts` consumes four shapes — `IgMedia`, `IgLocation`, `IgAccountRef`,
`IgProfile` — so a replacement provider has to fill those and nothing else.
Check whether the new provider also omits usertags on videos (that is why
`getMediaUsertags` exists), and rename the `hikerapi_request` SKU.

The regression set ([[../05-flows/instagram-import-flow#measured-quality]],
`npm run eval:instagram`) runs the production analyzer end to end, so it is the
test to re-run after a swap.

## Open questions

- **Billing reconciliation.** Nothing compares the tracked count with HikerAPI's
  own dashboard. Worth a look after the first real month of use.
