---
title: Deployment
type: overview
domain: ops
version: 1.2.0
last_updated: 19.11.2026
status: stable
sources:
  - next.config.ts
  - package.json
  - vercel.json
  - .github/workflows/dependabot.yml
related:
  - "[[_README]]"
  - "[[env-vars]]"
  - "[[../00-overview/tech-stack]]"
---

# Deployment

Vercel-hosted. Git-based auto-deploys. No custom CI.

## Platform

- **Vercel** (hosting + Functions). Account and project named in the Vercel dashboard.
- **Region:** `fra1` (Frankfurt), set in `vercel.json` (`regions`) since v1.44.0 — next to the Supabase project (`eu-central-1`). Before that this line already said "matches Supabase", but nothing set it: the functions ran in Vercel's default `iad1` (seen in `x-vercel-id: lhr1::iad1::…`), so every database call crossed the Atlantic. Check after a deploy: a function response's `x-vercel-id` reads `…::fra1::…`.
- **Build command:** `next build` (from `package.json` scripts).
- **Output:** Vercel's Next.js build, served as Vercel Functions (Fluid Compute) + static assets.

## Branches and environments

Typical Vercel branch mapping (verify in dashboard):

| Branch | Environment | URL |
|---|---|---|
| `main` | Production | `https://map-organiser.vercel.app` |
| any other branch / PR | Preview | `<branch-or-commit>.vercel.app` |

The current branch in this worktree is `claude/stoic-jang-554e86` (a Claude Code working branch).

## Deploy pipeline

```
git push origin <branch>
    │
    ▼
Vercel receives webhook
    │
    ▼
Build:
  • npm ci  (or whatever Vercel detects from package-lock.json)
  • next build
    │
    ▼
Deploy:
  • Static assets → Vercel edge network
  • Route handlers → Vercel Functions
  • Proxy (`src/proxy.ts`, Node.js) → Routing Middleware (Fluid Compute)
    │
    ▼
Health check (Vercel's built-in)
    │
    ▼
Promotion:
  • main → production URL
  • else → preview URL
```

## Env vars in Vercel

Set per environment (Production / Preview / Development) in Vercel → Settings → Environment Variables. Mirror the keys in [[env-vars]]. **`SUPABASE_SERVICE_ROLE_KEY`** and **`ENCRYPTION_SECRET`** are the two that must NEVER leak — set them server-only (no `NEXT_PUBLIC_` prefix).

`vercel pull` syncs them to a local `.env.local` for development.

## Auto-deploys

- **On every push to any branch:** Vercel creates a preview deployment.
- **On push to `main`:** Vercel promotes to production.
- **No manual approval gate** today. If we want one, configure in Vercel → Settings → Git → Deployment Protection.

## Manual deploy

From a local checkout with the Vercel CLI installed and authenticated:

```bash
vercel              # preview
vercel --prod       # production
```

Permission for the Vercel CLI is granted in `.claude/settings.local.json`. **Confirm before running `vercel --prod`** per [[../_agent/conventions#things-to-ask-before-doing]].

## Rollback

- **Via Vercel dashboard:** Deployments → pick the previous production deployment → Promote.
- **Via CLI:** `vercel alias set <previous-url> <production-domain>`.
- **DB schema rollback:** **NOT automatic.** Schema changes are forward-only (no reverse migrations stored). If a migration breaks production, write a forward-fix migration via Supabase MCP `apply_migration`.

## Pre-deploy checklist

Before promoting to production:

- [ ] `next build` locally succeeds.
- [ ] No `console.log` of secrets remains in code.
- [ ] `.env.local.example` matches what Vercel needs (add missing keys before deploy — currently `SUPABASE_SERVICE_ROLE_KEY` is one such gap).
- [ ] Any schema changes are applied to the Supabase project AND visible via `list_migrations`.
- [ ] If a new external integration: env vars added to Vercel for Production AND Preview (v1.28.0: `HIKERAPI_KEY` for the Instagram import).
- [x] Branch `feat/instagram-import`: its migration had to land **before** the code deployed — applied 16.10.2026, see [[../02-backend/schema/import-jobs#instagram-migration]].

## Post-deploy checks

- [ ] Visit `/` — landing loads.
- [ ] Sign in (OAuth and email/password if used).
- [ ] Open `/map` — Mapbox renders, places appear.
- [ ] Open a `/shared/<slug>` link — public payload renders (this exercises the service-role client and Mapbox Directions for plans).
- [ ] `/settings` → API tab loads (`api_keys` fetch works).

## Function timeouts

Vercel Function default timeout is **60 seconds** (verify current plan default). Routes that can run close to this limit:

- `POST /api/places/[id]/enrich?step=reviews` — DataForSEO reviews can take ~30 s.
- `GET /api/shared/[slug]` for a plan — Mapbox Directions per day in one request; a plan with many days can stack. (The app itself asks one day per request: `GET /api/plans/[id]/days/[dayId]/route`.)

Routes that export `maxDuration` (checked 16.10.2026):

| Route | `maxDuration` | Why |
|---|---|---|
| `/api/cron/refresh-places` | 300 | daily sweep; 240 s soft deadline |
| `/api/cron/drain-imports` | 300 | import queue; 240 s soft deadline |
| `/api/ai/chat` | 120 | multi-step agent turns (+ the Langfuse flush) |
| `/api/ai/day-plan` | 120 | bounded LLM call + one retry on degeneration |
| `/api/instagram/import` | 120 | the post read runs in `after()` and counts against the same invocation (v1.28.0) |

Everything else runs on the platform default. Vercel caps `maxDuration` at 300 s.

## Cron jobs

Configured in `vercel.json` (Vercel Cron fires on **production only**):

| Path | Schedule | What |
|---|---|---|
| `/api/cron/refresh-places` | `0 3 * * *` | daily periodic refresh — [[runbooks/periodic-refresh]] |
| `/api/cron/drain-imports` | `* * * * *` | the import queue (Takeout and Instagram jobs) — [[../05-flows/place-import-flow]] |

Both require `CRON_SECRET`. On preview deployments the drain only runs from the
kick at job creation and its own self-chain.

## Dependabot

`.github/workflows/dependabot.yml` opens weekly PRs for npm minor/patch updates. Major-version updates require manual review.

## Open questions

- **`vercel.ts` migration.** The Vercel knowledge update mentions `vercel.ts` as the preferred config (over `vercel.json`). The repo has neither — Vercel infers everything. If we add config (rewrites, redirects, headers, crons), use `vercel.ts`.
- **Production rollback testing.** No documented procedure has been tested. Worth a dry run.
