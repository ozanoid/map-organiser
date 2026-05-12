---
title: Share Target Flow
type: flow
domain: places
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/manifest.ts
  - src/app/api/share-target/route.ts
  - src/app/(app)/map/page.tsx
  - src/components/map/map-content.tsx
  - src/components/places/add-place-dialog.tsx
related:
  - "[[manual-place-create-flow]]"
  - "[[../02-backend/api-routes/share-target]]"
  - "[[../03-frontend/pwa-and-offline]]"
---

# Share Target Flow

How a Google Maps URL shared from a mobile share sheet ends up as a saved Place. This is the PWA's marquee mobile-inbound feature.

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
5. AddPlaceDialog opens with initialUrl = <decoded url>
       │
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
| 5 | `?add=<encoded_url>` | Add Place dialog opens with `initialUrl` |
| 6+ | Same as [[manual-place-create-flow]] | New place |

## Failure modes

- **No Google Maps URL in the share content.** Redirect to plain `/map`. User has no idea why the share didn't work. Worth a toast on `/map` when redirected without `?add=` to explain.
- **Unauthenticated share.** Middleware redirects to `/login`. The `?add=` param is lost unless the middleware preserves it via `?next=/map?add=...`. **Verify this in code** — it's listed as an open question in [[../02-backend/api-routes/share-target#open-questions]].
- **Invalid Google Maps URL.** Caught at step 6 (parse-link) with a 400.

## Related code

- `src/app/manifest.ts` — manifest declaration.
- `src/app/api/share-target/route.ts` — the public POST handler.
- `src/app/(app)/map/page.tsx` — reads `?add=`.
- `src/components/map/map-content.tsx` — opens the dialog with `initialUrl`.
- `src/components/places/add-place-dialog.tsx` — auto-fires parse on mount when `initialUrl` is present.

## Open questions

- **`next` survival.** When middleware bounces an unauthenticated user to `/login`, does the `?add=` make it back to `/map` after OAuth? Tests welcome.
- **Non-Google share sources.** Today the regex only matches Google domains. If we want to accept Bing Maps or Apple Maps URLs, expand the regex (and the parser).
- **UX on bad shares.** A user shares something we can't parse → they land on `/map` with no feedback. Add a toast or a "couldn't recognize that share" page.
