"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "@/lib/utils";

/**
 * Google/Apple-Maps-style draggable bottom sheet (mobile). Built on the
 * first-party base-ui Drawer (v1.6.0) — snap-point detents, swipe-to-
 * dismiss, `modal={false}` peek (the page behind stays interactive). The
 * Maps-peek transform/transition CSS mirrors base-ui's bundled example;
 * only the colours are swapped for our theme tokens.
 *
 * Detents live on `Drawer` (Root) via `snapPoints` (0-1 = viewport
 * fraction, >1 = px, or '148px'/'30rem' strings). Compose the shell as:
 *   <Drawer snapPoints={[...]} open onOpenChange modal={false}>
 *     <DrawerContent>
 *       <DrawerHeader><DrawerTitle>…</DrawerTitle></DrawerHeader>
 *       <DrawerBody>…scrolls…</DrawerBody>
 *       <DrawerFooter>…</DrawerFooter>   (optional)
 *     </DrawerContent>
 *   </Drawer>
 */

function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root {...props} />;
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerContent({
  className,
  children,
  showHandle = true,
  modal = true,
  ...props
}: DrawerPrimitive.Popup.Props & { showHandle?: boolean; modal?: boolean }) {
  return (
    <DrawerPrimitive.Portal>
      {/* Backdrop only for MODAL drawers. A non-modal peek (Maps-style)
          must leave the page behind visible + interactive. */}
      {modal && (
        <DrawerPrimitive.Backdrop
          data-slot="drawer-backdrop"
          className="[--backdrop-opacity:0.35] fixed inset-0 z-40 min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute"
        />
      )}
      {/* Non-modal: the full-screen Viewport must NOT swallow taps meant
          for the page behind — pointer-events-none on it, and
          pointer-events-auto on the sheet Popup (base-ui non-modal
          pattern). */}
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className={cn(
          "fixed inset-0 z-50 flex items-end justify-center touch-none",
          !modal && "pointer-events-none"
        )}
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "pointer-events-auto relative z-1 flex w-full max-h-[calc(100dvh-var(--top-margin,2.5rem))] min-h-0 flex-col overflow-visible rounded-t-2xl border-t border-border bg-popover text-popover-foreground shadow-lg outline-none touch-none",
            "[transform:translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] transition-[transform] duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0",
            "data-ending-style:[transform:translateY(calc(100%+2px))] data-starting-style:[transform:translateY(calc(100%+2px))]",
            className
          )}
          {...props}
        >
          {showHandle && (
            <div className="shrink-0 pt-2.5 pb-1 touch-none select-none">
              <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
          )}
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

/** Non-scrolling header region (drag-to-move works here). */
function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("shrink-0 px-4 pb-2 touch-none select-none", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Scrollable body — inner scroll coexists with sheet drag (overscroll
 *  contained, touch-auto so content scrolls while the header drags). */
function DrawerBody({ className, ...props }: DrawerPrimitive.Content.Props) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-body"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain touch-auto px-4",
        className
      )}
      {...props}
    />
  );
}

/** Sticky footer region with safe-area padding. */
function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "shrink-0 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]",
        className
      )}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
};
