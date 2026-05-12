---
title: Design System
type: overview
domain: design-system
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/globals.css
  - components.json
  - design-system/map-organiser/MASTER.md (preserved as docs/03-frontend/design-system/master.md)
  - src/components/ui/
related:
  - "[[../_README]]"
  - "[[../components/layout]]"
  - "[[../components/places]]"
  - "[[master]]"
  - "[[../../_archive/design-system_v2]]"
---

# Design System

The frontend's visual language: tokens, fonts, components, dark mode, marker icons. Three sources currently contribute to the design system; **`src/app/globals.css` is the runtime authority**.

## Sources of truth (and tension)

| Source | Role | Status |
|---|---|---|
| `src/app/globals.css` | Runtime CSS — actual tokens applied at render time | **Authoritative** |
| `components.json` | shadcn CLI config — style choice + path aliases | Authoritative for shadcn-installed components |
| [[master]] | A prior generation's brand-style doc (preserved from `design-system/map-organiser/MASTER.md`) | **Aspirational / historical** — diverges from the runtime |
| [[../../_archive/design-system_v2]] | The previous design-system doc (Apr 2026) | Archived; details retained for component micro-styles |

### Known divergence

`master.md` describes a brand palette (emerald `#059669` + orange `#F97316` + cream background `#ECFDF5`, Inter fonts). The runtime in `globals.css` is a neutral grayscale `oklch` palette (shadcn defaults) with `Geist` fonts.

The implementation reads as: **shadcn `base-nova` defaults + emerald accents** for primary CTAs and brand chrome (theme_color in the manifest is `#059669`). Treat `master.md` as the **brand intent** doc and `globals.css` as the **shipped behavior** until they reconcile.

## Tokens (runtime)

From `src/app/globals.css`:

### Imports

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@custom-variant dark (&:is(.dark *));
```

- **Tailwind v4** with PostCSS plugin.
- **`tw-animate-css`** adds animation utilities (entrance/exit, slide).
- **`shadcn/tailwind.css`** brings the `base-nova` style's base tokens.

### `@theme inline` block

Maps Tailwind color/radius utilities to CSS variables defined below. This is how Tailwind v4 exposes a token system — `text-card`, `bg-primary`, `border-input` all resolve through these.

Color tokens:

```
--color-background, --color-foreground
--color-card, --color-card-foreground
--color-popover, --color-popover-foreground
--color-primary, --color-primary-foreground
--color-secondary, --color-secondary-foreground
--color-muted, --color-muted-foreground
--color-accent, --color-accent-foreground
--color-destructive
--color-border, --color-input, --color-ring
--color-chart-1 ... --color-chart-5
--color-sidebar, --color-sidebar-foreground, ...
```

Radius tokens:

```
--radius (base, 0.625rem)
--radius-sm  = radius × 0.6
--radius-md  = radius × 0.8
--radius-lg  = radius
--radius-xl  = radius × 1.4
--radius-2xl = radius × 1.8
--radius-3xl = radius × 2.2
--radius-4xl = radius × 2.6
```

Fonts:

```
--font-sans:    "Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif
--font-mono:    "Geist Mono", "Geist Mono Fallback", ui-monospace, monospace
--font-heading: var(--font-sans)
```

### Light / dark palettes

`:root` defines the light palette; `.dark` overrides. All colors are `oklch`. The `.dark` class is applied to `<html>` by `next-themes` (`attribute="class"` in `src/lib/providers.tsx`).

Reference values (light):

```
--background: oklch(1 0 0);          /* white */
--foreground: oklch(0.145 0 0);      /* near-black */
--primary: oklch(0.205 0 0);         /* very dark gray — primary CTA */
--muted: oklch(0.97 0 0);
--border: oklch(0.922 0 0);
--destructive: oklch(0.577 0.245 27.325);  /* warm red */
```

The dark equivalents flip `background` and `foreground`, push `card`/`popover` to dark gray, and lighten muted/border accordingly.

### Brand accents in markup

Despite the neutral token palette, the **emerald-600 accent** (`#059669`) appears widely as hardcoded Tailwind utility values (`bg-emerald-600`, `text-emerald-600`) on:

- Primary action buttons (Save, Confirm).
- Active filter pills.
- Stats widgets.
- The PWA `theme_color`.

This is intentional but not currently captured as a token. If we want to swap the brand color, we'd grep for `emerald` across the codebase rather than editing a single variable.

## shadcn / `base-nova`

`components.json`:

```json
{
  "style": "base-nova",
  "iconLibrary": "lucide-react",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "lib": "@/lib",
    "hooks": "@/lib/hooks"
  }
}
```

- **Style:** `base-nova` — shadcn's modern variant built on `@base-ui/react` primitives.
- **Icons:** `lucide-react`. **Use only lucide icons** — no emojis, no other icon sets.
- **Base color:** `neutral` (grayscale).
- **CSS variables:** ON — tokens, not utility-class palette swap.

19 shadcn primitives installed in `src/components/ui/` — see [[../components/ui]] (when written).

## Fonts

`Geist` and `Geist Mono`, loaded by Next.js (via the `next/font` system, configured in the root layout — verify if not already). The font CSS variables are wired to Tailwind via `@theme inline`.

Master doc says Inter; that's wrong for the runtime.

## Dark mode

- Controlled by `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`).
- Toggle in `AppHeader`: Sun → Moon → Monitor cycle.
- Mounted guard prevents the hydration flash.
- CSS variables in `.dark` automatically swap when the class is applied to `<html>`.

**Mapbox popup overrides** (from archived v2 design system):

```css
.dark .mapboxgl-popup-content { background: #1a1a2e; color: #e2e8f0; }
.dark .mapboxgl-popup-tip   { border-top-color: #1a1a2e; }
```

Verify these are still in `globals.css`. If not, they're missing — Mapbox's default popup is white-on-white in dark mode.

## Custom map markers

The most distinctive design system component. Two styles, user-selectable via `useMapStyle`:

- **Dots** — `circle` layer in Mapbox. Color from category; stroke color from visit status.
- **Icons** — `symbol` layer. Lucide SVG icons rendered to canvas, registered with `map.addImage()`. Category color fill + white stroke + white icon.

Implementation: `src/lib/map/category-icons.ts`. Sprite registry covers the 12 default category icons:

| Category | Icon |
|---|---|
| Restaurant | `utensils` |
| Cafe | `coffee` |
| Bar & Nightlife | `wine` |
| Hotel & Accommodation | `bed-double` |
| Shopping | `shopping-bag` |
| Museum & Culture | `landmark` |
| Park & Nature | `trees` |
| Beach | `umbrella` |
| Gym & Sports | `dumbbell` |
| Health & Medical | `heart-pulse` |
| Entertainment | `ticket` |
| Other | `map-pin` |

> **Constraint:** user-added categories with custom icon names fall back to `map-pin` because no sprite exists for them. See [[../../01-domain/categories-and-tags#open-questions]].

## Anti-patterns

Lifted from [[master]] and the archived design-system doc — still valid:

- ❌ Emojis as icons. Use lucide only.
- ❌ Missing `cursor-pointer` on clickable elements.
- ❌ Layout-shifting hover transforms.
- ❌ Low-contrast text — keep 4.5:1 minimum, both modes.
- ❌ Instant state changes — always use transitions (150–300 ms).
- ❌ Invisible focus states — keyboard nav must be visible.

## When you add a new visual element

1. Check if a shadcn primitive covers it. If yes, `npx shadcn add <name>`.
2. Otherwise, build in `src/components/<area>/<Name>.tsx` using shadcn primitives + `cn()` for class merging.
3. Use tokens (`bg-card`, `text-foreground`) over raw colors when possible.
4. For accents, use Tailwind palette (`emerald-600`, `amber-600`) inline.
5. Document the component in [[../components/_README]] (or its sub-folder doc).
6. If it introduces a new token, add it to `globals.css` under `@theme inline` and `:root` / `.dark`.
7. Bump versions per [[../../_meta/vault-guide#when-you-edit-an-existing-doc]].

## Open questions

- **Reconcile `master.md` with `globals.css`.** Either rewrite `master.md` to reflect the shipped grayscale + emerald accent reality, or rebrand `globals.css` to match the master palette. Right now the master doc is misleading.
- **Tokenize the emerald accent.** `--color-brand` would let theme swaps and a "rebrand" pass go through one variable rather than a grep-and-replace.
- **Sprite for user-added category icons.** Either constrain the category icon picker to the 12 known icons or generalize `category-icons.ts` to lazy-generate sprites.
