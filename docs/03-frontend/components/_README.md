---
title: Components
type: overview
domain: frontend
version: 1.1.0
last_updated: 18.05.2026
status: stable
sources:
  - src/components/
related:
  - "[[../_README]]"
  - "[[../design-system/_README]]"
---

# Components

Feature components organized by area. shadcn primitives live separately in `src/components/ui/` (see [[ui-shadcn]]).

## Folder index

| Folder | Purpose | Doc |
|---|---|---|
| `filters/` | All filter UI (category w/ sub-cat cascade, country/city, list, tag, visit-status, search, panel + sheet) | [[filters]] |
| `layout/` | App chrome (header, sidebar, mobile nav, offline banner) | [[layout]] |
| `map/` | Mapbox view + the page-level map container | [[map]] |
| `places/` | Place cards, dialogs (incl. lite-profile AI Suggestions panel), bulk actions, inline creators, visit-status toggle, AI Summary card (place detail) | [[places]] |
| `settings/` | API key manager, cost tracker, AI master toggle (`AiSettings`), AI moderation queue (`AiSuggestionsQueue`) | [[settings]] |
| `ui/` | shadcn primitives (avatar, button, card, dialog, etc.) | [[ui-shadcn]] |
| (root) | `sw-register.tsx` — service worker registration | [[sw-register]] |

## Conventions across all components

- **`"use client"` at the top of any component with state, effects, or browser APIs.** Almost every feature component in this repo is client-side; layout components are exceptions.
- **Props interface above the component.** TypeScript `interface XxxProps`; default-exported component named `Xxx`.
- **shadcn primitives come from `@/components/ui`** — don't reach for raw HTML buttons / inputs.
- **`cn()` for class merging** — never raw template strings of class names.
- **Lucide icons only** — no emojis. Size and color via classes.
- **Tokenize colors when possible** (`text-foreground`, `bg-card`), use Tailwind palette for accents (`bg-emerald-600`).

## Naming

- `kebab-case.tsx` for the file.
- `PascalCase` for the component (default export).
- Filename matches the component name (`add-place-dialog.tsx` ↔ `AddPlaceDialog`).

## Adding a new component family

See [[../../_agent/common-tasks#add-a-new-component-family]]:

1. Create the file under `src/components/<area>/`.
2. If it needs a shadcn primitive that isn't installed: `npx shadcn add <name>`.
3. Document it in the corresponding `docs/03-frontend/components/<area>.md` (or add a new family doc + update this `_README`).
