---
title: Edge Functions
type: overview
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[_README]]"
  - "[[supabase-clients]]"
---

# Edge Functions

**There are currently no Supabase Edge Functions deployed in this project.** `mcp__supabase__list_edge_functions` returns an empty list.

This is intentional — the equivalent server logic runs as Next.js API route handlers (Vercel Functions). The two reasons we'd reach for a Supabase Edge Function instead:

| Reason | Reach for Edge Function if… |
|---|---|
| Database trigger / event-driven | The work must run synchronously as part of a DB transaction (use a Postgres function), or asynchronously off a Postgres NOTIFY / table change (use an Edge Function with `pg_net` or webhooks). |
| Long-running, scheduled, or off-band | We want `pg_cron`-triggered work that isn't a pure SQL job. |
| Geographic edge | The work benefits from running close to the user, not in our single region. (Less compelling now that Vercel Fluid Compute is regional.) |

None of these apply today.

## If we add one

Document it here with:

- **Function name** (deployed name).
- **Trigger** (HTTP, cron, table-change webhook, etc.).
- **Auth model** (anon-callable? requires service role?).
- **External integrations** it touches.
- **Source path** in the repo (`supabase/functions/<name>/index.ts` is the conventional location — note: this folder doesn't exist yet).
- **Deployment command** (`supabase functions deploy <name>` or via Supabase MCP `deploy_edge_function`).
- **Secrets** (Edge Functions have a separate secrets store — `supabase secrets set`).

## Verification

To re-confirm whether any Edge Functions exist:

- Run Supabase MCP `list_edge_functions` (project `hukppmaevcapvbrvxtph`).
- Or check the dashboard: Project → Edge Functions.

If the result diverges from "empty", update this doc and bump `version`.
