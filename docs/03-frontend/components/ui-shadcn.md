---
title: shadcn UI primitives
type: component
domain: frontend
version: 1.1.0
last_updated: 18.07.2026
status: stable
sources:
  - src/components/ui/
  - components.json
related:
  - "[[_README]]"
  - "[[../design-system/_README]]"
---

# shadcn UI primitives

Components in `src/components/ui/`. Installed via the **shadcn CLI** with the `base-nova` style (built on `@base-ui/react`). These are checked into the repo — not an npm dependency — so they're yours to edit.

## What's installed

21 primitives as of `last_updated`:

| File | Component | Common uses |
|---|---|---|
| `avatar.tsx` | `Avatar`, `AvatarFallback`, `AvatarImage` | User avatar in header |
| `badge.tsx` | `Badge` | Filter pills, status, place metadata |
| `bottom-sheet.tsx` | `BottomSheet` | **The** mobile sheet — see below |
| `button.tsx` | `Button` | Everywhere |
| `card.tsx` | `Card`, `CardHeader`, `CardContent`, `CardTitle`, `CardDescription`, `CardFooter` | `PlaceCard`, stats widgets |
| `command.tsx` | `Command` family | Command menu (cmdk-backed) |
| `dialog.tsx` | `Dialog` family | `AddPlaceDialog`, confirm modals |
| `drawer.tsx` | `Drawer` family | base-ui Drawer wrapper (`BottomSheet` builds on it) |
| `dropdown-menu.tsx` | `DropdownMenu` family | Header user menu, action menus |
| `input-group.tsx` | `InputGroup` | Search input wrapper |
| `input.tsx` | `Input` | Forms |
| `popover.tsx` | `Popover` family | Inline creators, color pickers |
| `select.tsx` | `Select` family | Filter sort dropdown |
| `separator.tsx` | `Separator` | Section dividers |
| `sheet.tsx` | `Sheet` family | Legacy side/overlay sheet (the mobile filter sheet moved to `BottomSheet` in v1.24.0) |
| `skeleton.tsx` | `Skeleton` | Loading placeholders |
| `sonner.tsx` | `Toaster` wrapper | Wired in root layout |
| `tabs.tsx` | `Tabs` family | Settings tabs, Lists/Trips tabs |
| `textarea.tsx` | `Textarea` | Notes inputs |

## `BottomSheet` — the one mobile sheet (v1.24.0)

Every draggable mobile panel renders through `BottomSheet`. It is not a
generic primitive with options — it **bakes in** the app's sheet contract
so panels can't drift apart (they did once: the add-place sheet got the
drag header and swipe guard while the place-detail sheet didn't).

```tsx
<BottomSheet open onClose={close} title="Filters"
  headerActions={<SaveFilterButton />}   // right of the title
  headerExtra={<SaveButton />}           // optional 2nd header row
  footer={…} modal={false}>
  {scrollingBody}
</BottomSheet>
```

The rules it enforces — change them **here**, never per consumer:

1. **Opens at half.** `snapPoints=[0.5, 0.92]`; no peek.
2. **The whole header drags.** The title row is a `touch-none`
   `DrawerHeader` outside the scroll container; only `children` scroll.
3. **Swipe-down never closes.** `onOpenChange` cancels
   `reason === "swipe"` *and* resets the controlled `snapPoint` to the
   resting detent — without that reset a fast flick springs back to full
   instead of dropping to half. `snapToSequentialPoints` stops base-ui's
   velocity snap-skipping from jumping to dismiss.
4. **Only the ✕ closes**, plus `disablePointerDismissal` so an outside tap
   can't discard an in-progress form.

Consumers: `FilterSheet`, `SearchResultPanel` (mobile), `PlaceDetailSheet`.
`drawer.tsx` stays the thin base-ui wrapper underneath; compose new sheets
from `BottomSheet`, not from `Drawer` directly.

## Conventions

- **Install with the CLI**, don't write primitives by hand:

  ```bash
  npx shadcn add <component>
  ```

  The CLI puts the file under `src/components/ui/`, updates `components.json`, and adds dependencies as needed.

- **Style:** `base-nova`. Set in `components.json`. **Don't switch styles** without a deliberate migration — the variants and class shapes differ between styles.

- **Icons:** `lucide-react`, set in `components.json#iconLibrary`. Some shadcn primitives import icons directly — keep them lucide.

- **Customization:** edit the file in place. shadcn's whole pitch is "this code is yours". Don't worry about breaking the upstream contract.

- **Compose, don't fork.** If you need a different button variant, add a variant via `cva` inside `button.tsx` rather than creating `button-special.tsx`.

## Tokens consumed

Every primitive uses CSS tokens from `globals.css` via Tailwind:

- `bg-background`, `text-foreground`
- `bg-card`, `text-card-foreground`
- `bg-primary`, `text-primary-foreground`
- `bg-muted`, `text-muted-foreground`
- `border`, `bg-input`, `ring`
- `text-destructive`

These automatically swap on `.dark` because the underlying CSS variables flip.

## Things to NOT do

- ❌ **Don't import from `@/components/ui/<x>`** in a way that bypasses the public exports. Each file exports the relevant family — use those.
- ❌ **Don't add JSX to a primitive that needs server-side rendering.** They're already `"use client"` where needed; don't override.
- ❌ **Don't replace `cn()`.** All primitives use it for class merging.

## Open questions

- **`tw-animate-css` overlap.** Some primitives ship their own animation utilities; verify they don't conflict with `tw-animate-css` imports.
- **Theme/style swap.** If we ever rebrand, the `base-color: neutral` + `style: base-nova` choice means most primitives' base look changes minimally — but variants would need a recheck.
