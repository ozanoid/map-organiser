---
title: Encryption
type: overview
domain: ops
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/lib/google/get-user-api-keys.ts (and the encryption helpers it imports)
  - src/components/settings/api-keys-manager.tsx
  - src/app/api/user/api-keys/route.ts
related:
  - "[[env-vars]]"
  - "[[../01-domain/users-and-profiles]]"
  - "[[../02-backend/schema/profiles]]"
  - "[[runbooks/_README]]"
---

# Encryption

How API keys provided by users are kept secret at rest.

## What's encrypted

Four columns on `public.profiles`, all `text` storing AES-256-GCM ciphertext:

- `google_api_key_enc` — user's personal Google Places API key
- `mapbox_token_enc` — user's personal Mapbox token (optional override of the public app token)
- `dataforseo_login_enc` — encrypted DataForSEO username
- `dataforseo_password_enc` — encrypted DataForSEO password

(The DataForSEO ones are reserved for future per-user billing; no UI surfaces them today.)

## Algorithm

- **Cipher:** AES-256-GCM
- **Key:** derived from `ENCRYPTION_SECRET` env var (server-only)
- **Nonce / IV:** generated per encryption operation; stored alongside the ciphertext (in the same `text` column, typically as a single base64-encoded blob)
- **Auth tag:** GCM mode; part of the ciphertext blob

Verify the exact encoding scheme by reading the encryption helpers (the helper functions imported by `src/lib/google/get-user-api-keys.ts` and `src/components/settings/api-keys-manager.tsx`). Typical layout:

```
ENCODED = base64( IV || ciphertext || authTag )
```

## Where encryption happens

| Direction | Location | Helper |
|---|---|---|
| Plaintext → ciphertext | `PUT /api/user/api-keys` | `encryptApiKey(value)` |
| Ciphertext → plaintext | Any server route that needs the user's keys | `decryptApiKey(value)` (called inside `getUserApiKeys`) |
| Display masking | `GET /api/user/api-keys` | `maskApiKey(value)` — first N + last M chars only |

The browser **never** sees a plaintext key after the user clears the input. `GET` returns only masked previews.

## Where plaintext appears

- In the input field on the Settings → API page while the user is typing.
- In transit (HTTPS) on the `PUT /api/user/api-keys` request body.
- In server memory for the lifetime of the encrypt call.

That's it. Nothing else stores plaintext.

## Anti-patterns (don't do)

- ❌ `console.log(process.env.ENCRYPTION_SECRET)` — never, even in dev.
- ❌ Logging decrypted values via `console.log(googleKey)`.
- ❌ Adding `NEXT_PUBLIC_` to the encryption secret.
- ❌ Storing the IV outside the ciphertext blob (loses portability).
- ❌ Reusing the same IV across encryptions.

## Key rotation

`ENCRYPTION_SECRET` rotation is **destructive without a re-encryption pass.** All `*_enc` columns become unreadable when the key changes.

Rotation procedure (no automation yet — write [[runbooks/rotate-encryption-secret|a runbook]] when needed):

1. Add a new env var (e.g. `ENCRYPTION_SECRET_NEW`) alongside the existing one in Vercel.
2. Deploy code that supports decrypt-with-old + encrypt-with-new.
3. Run a server-side script that reads each row, decrypts with the old key, re-encrypts with the new key, writes back.
4. Once all rows are migrated: delete the old env var.
5. Optionally rename `ENCRYPTION_SECRET_NEW` back to `ENCRYPTION_SECRET`.

This script doesn't exist today. Worth adding before the first rotation.

## Failure modes

- **Bad ciphertext / missing IV:** decrypt throws. `getUserApiKeys` falls back to env-level keys (e.g. `GOOGLE_PLACES_API_KEY`).
- **`ENCRYPTION_SECRET` missing:** every encrypt and decrypt call throws. Routes that need user keys return 500.
- **Key changed without re-encryption:** every existing `*_enc` column becomes garbage. Recovery: have the user re-enter their key.

## Storage layout snapshot

Current row counts:

- `profiles`: 3 rows.
- Likely: 1–2 of them have `google_api_key_enc` set, fewer have `mapbox_token_enc`.

Verify with:

```sql
SELECT
  count(*) FILTER (WHERE google_api_key_enc IS NOT NULL) AS has_google,
  count(*) FILTER (WHERE mapbox_token_enc IS NOT NULL) AS has_mapbox,
  count(*) FILTER (WHERE dataforseo_login_enc IS NOT NULL) AS has_dfseo
FROM profiles;
```

## Open questions

- **Encryption helper location.** Verify the actual file path (search for `encryptApiKey`). The helpers may live in a utility file not yet added to vault `sources`.
- **AAD (additional authenticated data).** GCM allows binding the ciphertext to a user_id via AAD. Confirm whether the helpers use this — if not, a stolen ciphertext could be replayed against another user's profile.
