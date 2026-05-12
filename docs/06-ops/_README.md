---
title: Ops Overview
type: overview
domain: ops
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[deployment]]"
  - "[[env-vars]]"
  - "[[encryption]]"
  - "[[monitoring]]"
  - "[[runbooks/_README]]"
---

# Ops Overview

How this app runs in production and how to operate it. The infrastructure is minimal: Vercel for hosting, Supabase for everything backend.

## Where to look

| Concern | Doc |
|---|---|
| How to deploy + the deploy pipeline | [[deployment]] |
| Every env var, where it lives, who sets it | [[env-vars]] |
| Encryption: ENCRYPTION_SECRET, encrypted columns, rotation | [[encryption]] |
| Logs, errors, alerting | [[monitoring]] |
| Step-by-step procedures | [[runbooks/_README]] |

## Production topology

```
┌──────────────────────────────────────────────────────────┐
│                       Vercel                              │
│  • Next.js 16 App Router build                            │
│  • Routes deployed as Vercel Functions (Fluid Compute)    │
│  • Middleware runs on every dynamic path                  │
│  • Static assets served from the edge                     │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  Supabase Project                         │
│  (hukppmaevcapvbrvxtph, eu-central-1, Pro)                │
│  • Postgres + PostGIS                                     │
│  • Auth (Google OAuth + email/password)                   │
│  • Storage (place-photos bucket)                          │
│  • No edge functions deployed                             │
└──────────────────────────────────────────────────────────┘

External services:
  • Mapbox  — Map tiles + Directions API
  • Google Places API  — per-user, optional
  • DataForSEO  — default enrichment provider
```

## CI / CD

- **No CI workflows beyond Dependabot.** No tests run on PR. No type-check job. Builds rely on Vercel's own validation.
- **Dependabot:** `.github/workflows/dependabot.yml` — weekly npm minor/patch updates only.
- **Vercel auto-deploys on push** (Git integration; verify branch → environment mapping in the Vercel dashboard).

## What's missing

- **No automated tests.** Manual QA only. See the archived [[../_archive/test-plan_v2|test plan v2]] for an aspirational strategy.
- **No monitoring beyond Vercel + Supabase dashboards.** No Sentry, no Datadog, no per-route alerting.
- **No backups process documented.** Supabase handles automated DB backups on Pro; verify retention.
- **No incident playbooks.** Add to [[runbooks/_README]] as incidents arise.

## Defaults you should know

| Thing | Default |
|---|---|
| Function timeout | 60 s (Vercel default; check current plan) |
| Cron jobs | None |
| Rate limiting | None app-level. Mapbox + DataForSEO + Google have their own. |
| Logs retention | Vercel default (~1 day for free tier; longer on Pro — verify) |
| DB backups | Supabase Pro automated daily |
| RPO / RTO | Not formally defined. Effectively ~24 hours (last backup). |

## Adding ops docs

- **Runbooks** go under `runbooks/<short-name>.md`. Trigger → preconditions → steps → verification → rollback.
- **Cross-cutting ops topics** get their own top-level doc here (like [[deployment]], [[env-vars]]).
- Update this `_README` whenever you add a doc.
