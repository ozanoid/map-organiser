---
title: Share Target Flow
type: flow
domain: places
version: 1.1.1
last_updated: 16.10.2026
status: stable
sources:
  - src/app/manifest.ts
  - src/app/api/share-target/route.ts
  - src/app/(app)/map/page.tsx
  - src/components/map/map-content.tsx
  - src/components/places/add-place-dialog.tsx
related:
  - "[[manual-place-create-flow]]"
  - "[[instagram-import-flow]]"
  - "[[../02-backend/api-routes/share-target]]"
  - "[[../03-frontend/pwa-and-offline]]"
---

# Share Target Flow

How a Google Maps URL shared from a mobile share sheet ends up as a saved Place. This is the PWA's marquee mobile-inbound feature.

> **Two ways in, one landing URL (v1.28.0).** Everything below converges on
> `/map?add=<encoded url>`. The PWA share sheet gets there through
> `POST /api/share-target`, which forwards **Google Maps links only**. On iPhone
> the entry is an iOS Shortcut, "Add to MapOrganiser", that opens
> `/map?add=<url-encoded link>` directly — no share-target route involved — and it
> carries Instagram links too. When the link is an Instagram post or reel, the Add
> Place dialog switches to the Instagram import instead of the parse-link preview:
> see [[instagram-import-flow]]. Any other Instagram link (a profile) gets an
> inline "not a post" hint instead of the parser. Since v1.28.1 the header's Add
> Place also lands here: it hands a pasted Instagram post link to
> `/map?add=` so the map page runs the import.

## Trigger

User is on mobile, viewing a Google Maps place, taps the OS share button, picks **Map Organiser** from the share sheet.

## Steps

```
1. OS share sheet → POST /api/share-target  (multipart form)
       │  Body: { url?, text?, title? } per manifest.share_target.params
       │  • PUBLIC route — no auth check
       │  • Concatenates fields
       │  • Regex for google.com/maps, maps.app.goo.gl, goo.gl/maps
       │  • If found: redirect to /map?add=<encoded>
       │  • Else: redirect to /map
       │
       ▼
2. Browser follows the redirect to /map?add=...
       │
       ▼
3. Middleware runs on /map
       │  • If not authenticated → redirect to /login (the `?add=` param is dropped
       │    unless preserved via ?next= — see open questions)
       │  • If authenticated → continue
       │
       ▼  (authenticated branch)
4. /map page loads. MapContent reads `?add=` from searchParams.
       │
       ▼
5. AddPlaceDialog opens with initialUrl = <decoded url>; MapContent removes `add`
   from the URL (the rest of the query string, the filters, stays)
       │  • Instagram post/reel link (parseInstagramPostUrl)? → Instagram mode,
       │    see [[instagram-import-flow]]; the steps below do not run
       │  • Any other Instagram link (isInstagramUrl)? → inline "not a post"
       │    hint; the steps below do not run
       ▼
6. AddPlaceDialog auto-fires useParseLink (same as [[manual-place-create-flow|manual create]] from step 3 onward)
       │
       ▼
7. User reviews preview, picks options, saves.
       │
       ▼
8. Standard place-create flow continues with enrichment.
```

## Manifest declaration

`src/app/manifest.ts`:

```ts
share_target: {
  action: "/api/share-target",
  method: "POST",
  enctype: "application/x-www-form-urlencoded",
  params: {
    url: "url",
    text: "text",
    title: "title",
  },
}
```

The OS share sheet sends the chosen URL/text/title under those form keys.

## Why the route is public

The PWA spec requires the share target to accept POST without authentication — the OS doesn't carry a session cookie. The route doesn't touch the DB; it just redirects. Auth gating happens at the next step (`/map`).

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 1 | `application/x-www-form-urlencoded` with optional `url`, `text`, `title` | HTTP redirect to `/map?add=...` (or `/map`) |
| 5 | `?add=<encoded_url>` | Add Place dialog opens with `initialUrl` (Instagram link → Instagram mode) |
| 6+ | Same as [[manual-place-create-flow]] | New place |

## Failure modes

- **No Google Maps URL in the share content.** Redirect to plain `/map`. User has no idea why the share didn't work. Worth a toast on `/map` when redirected without `?add=` to explain. This includes an **Instagram link shared through the PWA share sheet** — the route's regex does not match it, so it never reaches the Instagram import.
- **Unauthenticated share.** Middleware redirects to `/login`. The `?add=` param is lost unless the middleware preserves it via `?next=/map?add=...`. **Verify this in code** — it's listed as an open question in [[../02-backend/api-routes/share-target#open-questions]].
- **Invalid Google Maps URL.** Caught at step 6 (parse-link) with a 400.

## Related code

- `src/app/manifest.ts` — manifest declaration.
- `src/app/api/share-target/route.ts` — the public POST handler.
- `src/app/(app)/map/page.tsx` — reads `?add=`.
- `src/components/map/map-content.tsx` — opens the dialog with `initialUrl` whenever `?add=` appears (the same link may come again once the param is gone), then removes only `add`.
- `src/components/places/add-place-dialog.tsx` — auto-fires parse on mount when `initialUrl` is present and is not an Instagram link; an Instagram post link renders `InstagramImportPanel` instead, any other Instagram link the "not a post" hint.

## Open questions

- **`next` survival.** When middleware bounces an unauthenticated user to `/login`, does the `?add=` make it back to `/map` after OAuth? Tests welcome.
- **Non-Google share sources.** Today the regex only matches Google domains. If we want to accept Bing Maps or Apple Maps URLs, expand the regex (and the parser). Instagram needs only the regex: the dialog already recognises Instagram links in `initialUrl`, so forwarding `instagram.com/(p|reel|reels|tv)/…` to `/map?add=` would route PWA shares into the Instagram import.
- **UX on bad shares.** A user shares something we can't parse → they land on `/map` with no feedback. Add a toast or a "couldn't recognize that share" page.
