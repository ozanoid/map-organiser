---
title: Flows
type: overview
domain: overview
version: 1.0.0
last_updated: 12.05.2026
status: stable
related:
  - "[[auth-flow]]"
  - "[[signup-flow]]"
  - "[[place-import-flow]]"
  - "[[manual-place-create-flow]]"
  - "[[trip-planning-flow]]"
  - "[[share-flow]]"
  - "[[share-target-flow]]"
  - "[[offline-flow]]"
---

# Flows

End-to-end user / data flows that span multiple subsystems. Each doc traces the sequence from trigger to final state, naming every API route, DB table, and external call along the way.

## Index

| Flow | Trigger | Touches |
|---|---|---|
| [[auth-flow]] | User clicks "Sign in" | middleware, OAuth callback, Supabase Auth |
| [[signup-flow]] | New user authenticates for the first time | `auth.users`, `handle_new_user`, `create_default_categories`, 12 categories seeded |
| [[place-import-flow]] | User uploads a Takeout file | `/api/places/import-parse` → loop of `/api/places/import-batch` |
| [[manual-place-create-flow]] | User pastes a Google Maps URL or hits the FAB | `/api/places/parse-link` → `/api/places` → enrich |
| [[trip-planning-flow]] | User creates a trip from a list | `/api/trips` → optional `/api/trips/[id]/auto-plan` → day-place mutations |
| [[share-flow]] | User clicks "Share" on a list or trip | `/api/shared` (POST) → public `/shared/<slug>` → optional save |
| [[share-target-flow]] | User shares a URL into the PWA from mobile share sheet | `/api/share-target` → `/map?add=…` → manual-place-create-flow |
| [[offline-flow]] | Network drops while the user is in the app | SW, offline banner, `/offline` fallback |

## How to read a flow doc

Each follows the [[../_meta/templates/flow|flow template]]:

1. **Trigger** — what initiates the flow.
2. **Steps** — ordered list with the file paths involved.
3. **Inputs / outputs** — what data goes in and what's persisted.
4. **Failure modes** — every step that can fail and how it surfaces.
5. **Related code** — bulleted file list for fast jumps.

## When to add a new flow doc

When you build a feature that touches **more than two** of (UI, API, DB, external service). One-API-route features don't need a flow doc — the route's `02-backend/api-routes/<group>.md` entry is enough.
