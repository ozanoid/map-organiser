---
title: Env Vars
type: overview
domain: ops
version: 1.14.0
last_updated: 26.11.2026
status: stable
sources:
  - .env.local.example
  - src/lib/supabase/client.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/proxy.ts
  - src/lib/agent/client.ts
  - src/lib/google/get-user-api-keys.ts
  - src/lib/dataforseo/client.ts
  - src/instrumentation-node.ts
  - src/lib/telemetry/langfuse.ts
  - src/app/api/cron/refresh-places/route.ts
  - src/app/api/cron/drain-imports/route.ts
  - src/app/api/cron/notify/route.ts
  - src/lib/import/kick-drain.ts
  - src/lib/hikerapi/client.ts
  - src/app/api/instagram/import/route.ts
  - scripts/instagram-eval/run.ts
  - src/lib/notify/config.ts
  - src/lib/notify/email.ts
  - src/lib/notify/telegram.ts
  - src/app/api/telegram/webhook/route.ts
  - src/lib/notify/access.ts
related:
  - "[[_README]]"
  - "[[encryption]]"
  - "[[deployment]]"
  - "[[../04-integrations/supabase]]"
  - "[[../04-integrations/mapbox]]"
  - "[[../04-integrations/google-places]]"
  - "[[../04-integrations/dataforseo]]"
  - "[[../04-integrations/hikerapi]]"
---

# Env Vars

Every environment variable the app reads, where it lives, and who depends on it.

## Canonical list

| Variable | Public? | Required? | Source | Used by |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ public | yes | Supabase project | Browser + server clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ public | yes | Supabase project | Browser + server clients |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ server-only | yes | Supabase project → Settings → API | `createServiceClient()` — public share reads, both cron routes, the import-queue writes, the Instagram import's background job and its branch pick ([[../02-backend/supabase-clients]] lists the seven callers). Without it sharing, both imports and the crons break. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | ✅ public (URL-restricted) | yes | Mapbox account → tokens | MapView + server-side Directions fallback |
| `MAPBOX_SERVER_TOKEN` | ❌ server-only | optional (recommended) | Mapbox account → secret token (no URL restriction) | `src/lib/mapbox/search-box.ts` proxy for Search Box `/suggest` and `/retrieve`; `src/lib/mapbox/geocode.ts` for the assistant's neighbourhood search (17.11.2026). Falls back to public token if absent. |
| `GOOGLE_PLACES_API_KEY` | ❌ server-only | **unused since v1.42.0** | Google Cloud Console | Read by no code: the Instagram import and the Add Place preview look places up through DataForSEO. Can be removed from Vercel and `.env.local`. |
| `ENCRYPTION_SECRET` | ❌ server-only | yes | Generated; documented in [[encryption]] | `encryptApiKey` / `decryptApiKey` for `profiles.*_enc` |
| `DATAFORSEO_LOGIN` | ❌ server-only | yes | DataForSEO account | Default enrichment provider basic auth |
| `DATAFORSEO_PASSWORD` | ❌ server-only | yes | DataForSEO account | Same |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ❌ server-only | **unused since v1.55.0** | https://aistudio.google.com/apikey | Read by no code: the Gemini client (`src/lib/ai/client.ts`) went with the evals' Gemini arms — every AI feature runs on Claude. Nothing calls Gemini since the merge 7df90df to main (25.11.2026): delete it from Vercel (Production + Preview) and `.env.local`, and revoke it in Google AI Studio (Ozan). |
| `CRON_SECRET` | ❌ server-only | **yes** | Generated; set in Vercel | Bearer auth for the three cron routes: `refresh-places` (daily), `drain-imports` (every minute) and `notify` (every 15 minutes, v1.58.0 — compared in constant time, `bearerMatches`). Absent → all three return 500 — **no reminders or weekly summaries go out** — **and imports silently never start** — `kickDrain`, fired when a Takeout job is created, when an Instagram job has queued places and when a branch picked in the Instagram dialog is queued, no-ops without it. An Instagram import then reads its post but its places sit at "Adding…". Not present in `.env.local` by default, so imports do not drain locally. See [[runbooks/periodic-refresh]], [[../05-flows/place-import-flow]] and [[../05-flows/instagram-import-flow]]. |
| `HIKERAPI_KEY` | ❌ server-only | optional (required for the Instagram import) | HikerAPI account (hikerapi.com) | `src/lib/hikerapi/client.ts` — header `x-access-key` on every HikerAPI call. `POST /api/instagram/import` checks it before creating a job and answers 503 "Instagram import isn't set up on this server." without it. Read from `.env.local` by `npm run eval:instagram`. See [[../04-integrations/hikerapi]]. v1.28.0. |
| `ASSISTANT_OWNER_EMAILS` | ❌ server-only | **yes** for the Claude connector and the in-app assistant | Set by the owner, comma-separated emails | Who may use an assistant on their library (`src/lib/assistant/owner.ts`): connect Claude — checked on `/oauth/consent` and on every `/api/mcp` call — and, since v1.56.0, the in-app assistant (`assistantOpenTo`, `src/lib/agent/door.ts`: anyone else gets 403 `not_owner` from the assistant routes and sees no button or entry). Unset → nobody: every connection is refused and the in-app assistant is closed. Since v1.57.0 also who may receive notifications (`notifyContext`, `src/lib/notify/access.ts`): anyone else gets 403 `not_owner` from the notification routes. Owner: `ozan@maporganiser.com`; `admin@maporganiser.com` for tests. See [[../04-integrations/claude-mcp]]. |
| `ANTHROPIC_API_KEY` | ❌ server-only | required for every AI feature (the assistant, place profiles, the Instagram import) | Claude Console → API keys | The Claude API (`src/lib/agent/client.ts`): the platform's agent core and the app's assistant (v1.47.x–v1.48.0; on main since 25.11.2026) — without it the assistant button stays hidden; one-shot structured calls (`structured.ts`, the 6.2 measurement); `npm run eval:assistant`, `eval:profiles`, `eval:instagram`. Since v1.51.0 also place profiles (Sonnet 5.5) and Instagram post reads (Haiku 5.5) — the Instagram import refuses to start without it, `step=profile` answers 503, and Settings → AI disables the AI switch with a banner and hides the profile backfill and the suggestions queue. Set in Vercel Production + Preview on 17.11.2026. Monthly spend is capped at organization level in the Claude Console and by the platform's own ledger ($100, `assistant_spend`). |
| `RESEND_API_KEY` | ❌ server-only | optional (required for e-mail) | resend.com → API Keys (Ozan) — a sending-only key is enough | `src/lib/notify/email.ts` — every e-mail: the address confirmation, Settings' test, "Send to me" (v1.57.0). With `EMAIL_FROM` it makes `emailConfigured()` true; without either, Settings says "E-mail isn't set up on this server", `PUT /api/notifications/email` answers 503 and sends list e-mail as `not_connected`. Production + Preview + `.env.local`. See [[../04-integrations/resend]]. |
| `EMAIL_FROM` | ❌ server-only | optional (with `RESEND_API_KEY`) | A sender on the domain verified in Resend | The sender of every e-mail: `hello@mappy.site` (v1.57.0; Ozan's domain, 25.11.2026). A bare address goes out as `Mappy <hello@mappy.site>` (`fromHeader`, `src/lib/notify/email.ts`; the name is `SENDER_NAME` in `render.ts`, 26.11.2026); "Name <address>" is used as it is. |
| `TELEGRAM_BOT_TOKEN` | ❌ server-only | optional (required for Telegram) | @BotFather (Ozan) — `<number>:<about 35 characters>`, nothing around it | `src/lib/notify/telegram.ts` — every Bot API call (v1.57.0). **Production only** (Phase 3, decision 13: a bot has one webhook address) — set there on 26.11.2026 (the bot is `@mappysitebot`); with `TELEGRAM_BOT_USERNAME` it makes `telegramConfigured()` true. Whoever has it controls the bot: if it leaks, `/token` in @BotFather replaces it. See [[../04-integrations/telegram]]. |
| `TELEGRAM_BOT_USERNAME` | ❌ server-only | optional (with the token) | The bot's username, `@` optional — `mappysitebot` | The start link `https://t.me/<username>?start=<token>` (v1.57.0). Checked against the token's bot (`getMe`) on every Connect in production; a mismatch is refused (v1.57.6). |
| `TELEGRAM_WEBHOOK_SECRET` | ❌ server-only | optional (required for the webhook) | Generated: `openssl rand -hex 32` | `src/app/api/telegram/webhook/route.ts` compares Telegram's `X-Telegram-Bot-Api-Secret-Token` header with it in constant time; the app gives the same value to `setWebhook` as `secret_token` when Connect registers the webhook (`registerWebhook`, v1.57.6). Unset → the webhook answers 404 (v1.57.0). |
| `VERCEL_ENV` | set by Vercel (system variable) | — | Vercel | `registerWebhook` (`src/lib/notify/telegram.ts`) points the bot at the webhook only when it is `production` (Phase 3, decision 13); unset (local) or `preview` → skipped. The first code to read it (v1.57.6). |
| `VERCEL_PROJECT_PRODUCTION_URL` | set by Vercel (system variable) | — | Vercel — the project's shortest production domain, no `https://` | The links in the reminders and weekly summaries (`/api/cron/notify`, v1.58.0): the cron's own request may come in on a deployment address, the links should open the app's production address. Unset (local) → the address the cron was called on. |
| `HONEYCOMB_API_KEY` | ❌ server-only | optional (required for the Honeycomb pipe) | Honeycomb → ingest key | `src/instrumentation-node.ts` — OTel trace + log exporters. Absent → Honeycomb pipe dark, console pipe unaffected. |
| `HONEYCOMB_DATASET` | ❌ server-only | optional | — | Dataset name; defaults to `map-organiser`. |
| `HONEYCOMB_API_URL` | ❌ server-only | optional | — | Defaults to `https://api.honeycomb.io` (US). |
| `LANGFUSE_PUBLIC_KEY` | ❌ server-only | optional (required for the Langfuse pipe) | cloud.langfuse.com → Settings → API Keys | `src/lib/telemetry/langfuse.ts` — LLM span export. Absent (with the secret) → processor skipped entirely. |
| `LANGFUSE_SECRET_KEY` | ❌ server-only | optional (same) | Same | Same. |
| `LANGFUSE_BASE_URL` | ❌ server-only | optional | — | Read by the Langfuse SDK itself; EU cloud default `https://cloud.langfuse.com`. |

The notification settings (`RESEND_API_KEY`, `EMAIL_FROM`, `TELEGRAM_*`) are read through `src/lib/notify/config.ts`, trimmed — a value pasted with a space or a line break around it still works (v1.57.9) — and the Telegram ones checked for their shape before Telegram is called (`telegramSettingsProblem`: the variable and what looks wrong are named, the value never). Connect needs all three Telegram values.

## Where they're set

| Environment | Source |
|---|---|
| Local development | `.env.local` (gitignored) — copy from `.env.local.example`, fill in values |
| Vercel Preview | Vercel dashboard → Environment Variables → Preview |
| Vercel Production | Vercel dashboard → Environment Variables → Production |

`vercel pull` syncs Vercel env vars into a local `.env.local` for matching the deployed environment.

## Known gaps

### `SUPABASE_SERVICE_ROLE_KEY` missing from `.env.local.example`

The example file does NOT list `SUPABASE_SERVICE_ROLE_KEY`, but `src/lib/supabase/server.ts#createServiceClient` reads it. **A fresh clone won't have public sharing, either import (Takeout or Instagram) or the cron routes working until the dev figures this out.**

Fix:

```diff
 # Supabase
 NEXT_PUBLIC_SUPABASE_URL=
 NEXT_PUBLIC_SUPABASE_ANON_KEY=
+SUPABASE_SERVICE_ROLE_KEY=

 # Mapbox
```

Then bump this doc's version.

### `profiles.dataforseo_login_enc` / `dataforseo_password_enc` exist but unused

The schema has columns for per-user DataForSEO credentials, but no API route exposes them. DataForSEO is env-only today. If we add per-user DataForSEO billing, surface them in `/api/user/api-keys`.

## What "public" means

`NEXT_PUBLIC_` is a Next.js convention: any env var prefixed with it is embedded into the browser bundle. **Anything without that prefix is server-only** and cannot be read from Client Components.

Practical rules:

- **Never** add `NEXT_PUBLIC_` to a secret. Once it's in the bundle, it's public.
- **`NEXT_PUBLIC_MAPBOX_TOKEN`** is intentionally public — Mapbox restricts it by URL on their side.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** is intentionally public — RLS protects the data, the anon key is just a JWT issuer key.

## What lives where

| Env var | Loaded from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `process.env.NEXT_PUBLIC_SUPABASE_URL` in all three Supabase client files |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | `process.env.SUPABASE_SERVICE_ROLE_KEY` in `src/lib/supabase/server.ts#createServiceClient` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `process.env.NEXT_PUBLIC_MAPBOX_TOKEN` in `MapView` and `src/lib/plans/directions.ts` |
| `GOOGLE_PLACES_API_KEY` | — (unused since v1.42.0) |
| `ENCRYPTION_SECRET` | `process.env.ENCRYPTION_SECRET` in the AES-256-GCM helpers |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | `process.env.DATAFORSEO_*` in `src/lib/dataforseo/client.ts` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — (unused since v1.55.0) |
| `ANTHROPIC_API_KEY` | `process.env.ANTHROPIC_API_KEY` in `src/lib/agent/client.ts#anthropicClient`, and the presence checks in `src/lib/agent/door.ts`, `src/lib/ai/generate-profile.ts` and `src/lib/instagram/start-import.ts` |
| `CRON_SECRET` | `process.env.CRON_SECRET` in `src/app/api/cron/refresh-places/route.ts` and `src/app/api/cron/drain-imports/route.ts` (bearer check, and the drain's self-chain), `src/app/api/cron/notify/route.ts` (through `bearerMatches`, `src/lib/api/bearer.ts`; v1.58.0), plus `kickDrain` in `src/lib/import/kick-drain.ts` (moved there from the import-jobs route in v1.28.0; called by the Takeout create route, the Instagram import job and, since v1.28.1, the Instagram pick route) |
| `HIKERAPI_KEY` | `process.env.HIKERAPI_KEY` in `src/lib/hikerapi/client.ts#get` and the presence check in `src/app/api/instagram/import/route.ts` |
| `RESEND_API_KEY` / `EMAIL_FROM` | `process.env.*` in `src/lib/notify/email.ts` (`resend()`, `sendEmail`) and `src/lib/notify/config.ts#emailConfigured` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | `process.env.*` in `src/lib/notify/telegram.ts#telegramCall` and `src/lib/notify/config.ts` (`telegramConfigured`, `telegramBotUsername`) |
| `TELEGRAM_WEBHOOK_SECRET` | `process.env.TELEGRAM_WEBHOOK_SECRET` in `src/app/api/telegram/webhook/route.ts` and `src/lib/notify/telegram.ts#registerWebhook` |
| `VERCEL_ENV` | `process.env.VERCEL_ENV` in `src/lib/notify/telegram.ts#registerWebhook` |
| `VERCEL_PROJECT_PRODUCTION_URL` | `process.env.VERCEL_PROJECT_PRODUCTION_URL` in `src/app/api/cron/notify/route.ts` |
| `HONEYCOMB_API_KEY` / `HONEYCOMB_DATASET` / `HONEYCOMB_API_URL` | `process.env.HONEYCOMB_*` in `src/instrumentation-node.ts` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | `process.env.LANGFUSE_*` in `src/lib/telemetry/langfuse.ts` (presence gate) |
| `LANGFUSE_BASE_URL` | Read internally by `LangfuseSpanProcessor` (`@langfuse/otel`) — no direct `process.env` read in app code |

## When to add a new env var

See [[../_agent/common-tasks#update-env-vars]]. The short checklist:

1. Add to `.env.local.example` with a comment (no value).
2. Add to Vercel Preview + Production.
3. Update this doc.
4. If it's an integration secret, also update the matching `04-integrations/<service>.md`.
5. CHANGELOG.

## Open questions

- **Validation at startup.** No code asserts the presence of required env vars. A bad config silently produces broken auth or crashed routes. Worth a `src/lib/env.ts` that validates with Zod at module load — `if (!url) throw new Error(...)`.
- **Per-environment defaults.** No `.env.development` / `.env.production` defaults committed. Always rely on Vercel / local `.env.local`.
