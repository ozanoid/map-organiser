---
title: Share Target route
type: route-group
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/share-target/route.ts
  - src/app/manifest.ts
related:
  - "[[_README]]"
  - "[[../auth#public-route-table]]"
  - "[[../../01-domain/places]]"
---

# Share Target route

The receiver for the PWA Web Share Target API. Mobile users who hit "Share" on a Google Maps location and pick the installed app send the URL/text here.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/share-target` | **PUBLIC** | Accept the share payload, extract a Google Maps URL, redirect to `/map?add=<url>`. |

## Per-route detail

### `POST /api/share-target`

- **Source:** `src/app/api/share-target/route.ts`
- **Auth:** **None.** The PWA sends this request before the user's session is even involved — the user could be signed out.
- **Body:** `multipart/form-data` with optional fields `url`, `text`, `title` (per the manifest's `share_target.params`).
- **DB:** none.
- **External:** none — regex matching only.
- **Behavior:**
  1. Concatenates `url`, `text`, `title` from the form body.
  2. Searches with a regex covering `google.com/maps/...`, `maps.app.goo.gl/...`, `goo.gl/maps/...`.
  3. If a match is found: `Response.redirect(/map?add=<encodedUrl>)`.
  4. Otherwise: `Response.redirect(/map)`.
- **Response:** HTTP redirect (3xx). No JSON body.

## Why public?

The PWA spec requires the share-target endpoint to accept POST without authentication — at the moment the OS share sheet fires, there's no guarantee the user has a session cookie set in the browser. The route does **nothing sensitive** itself: it parses input, looks for a known URL pattern, and redirects to a page that itself enforces auth (`/map` is gated by the middleware → unauthenticated users get redirected to `/login?next=/map?add=...`).

A malicious POSTer could:

- Send arbitrary text → just gets redirected. No DB write, no side effect.
- Burn DOS volume on the route. Vercel rate limiting and the lack of DB work make this low-cost to absorb.

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

(Note: the manifest declares `enctype: application/x-www-form-urlencoded` but the route reads via `await req.formData()` which handles both that and `multipart/form-data`.)

## Downstream flow

After the redirect, `/map?add=<url>` is read by the map page client-side, which opens the Add Place dialog pre-populated with the URL. The user (now in an authenticated context) confirms; the rest is the standard place-creation flow via `/api/places/parse-link` → `/api/places`.

## Open questions

- **Sign-in friction.** Anonymous shares get redirected to `/login?next=/map?add=...`. Worth verifying the `next` param survives the OAuth handshake — if not, the user lands on `/map` empty and the share is lost.
- **Non-Google Maps URLs.** Falls back to plain `/map`. Could surface a toast or a "we don't recognize this share source" message; today it silently drops the input.
