/**
 * Class for an icon-only button: 36 px visible, 44 px hit area (the `after`
 * layer), so it can sit in a dense row and still be tapped reliably. Give
 * the button an aria-label.
 */
export const ICON_BUTTON =
  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground " +
  "transition-colors hover:bg-accent hover:text-foreground cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent " +
  "after:absolute after:-inset-1 after:content-['']";
