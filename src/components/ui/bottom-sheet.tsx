"use client";

import * as React from "react";
import { X } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The ONE mobile bottom sheet. Every draggable panel in the app renders
 * through this component so their structure and gestures can never drift
 * apart (the add-place sheet and the place-detail sheet behaving
 * differently was exactly the bug this exists to prevent).
 *
 * House rules, baked in — not per-consumer options:
 *
 *  1. **Opens at half.** `snapPoints = [0.5, 0.92]`; the first point is the
 *     resting height. No peek (a peek shows nothing useful).
 *  2. **The whole header is the drag zone.** The title row lives in a
 *     `touch-none` region OUTSIDE the scroll container, so dragging
 *     anywhere on the header moves the sheet instead of scrolling the
 *     body. Only `children` scroll.
 *  3. **Swiping down NEVER closes.** base-ui reports a dismiss as
 *     `reason === "swipe"`; we cancel it and settle on the lowest detent.
 *     The explicit reset matters: cancelling alone makes a fast flick
 *     spring back to FULL instead of dropping to half.
 *  4. **Only the ✕ closes** (plus whatever the consumer puts in
 *     `headerActions`). `disablePointerDismissal` also stops an outside
 *     tap from discarding an in-progress form.
 *
 * `snapToSequentialPoints` disables base-ui's velocity-based snap
 * skipping, so a hard flick steps full → half instead of jumping straight
 * to "dismiss".
 */

/** Half, then near-full. Module-level so the identity stays stable. */
const SNAP_POINTS: number[] = [0.5, 0.92];
const RESTING_SNAP = SNAP_POINTS[0];

export interface BottomSheetProps {
  open: boolean;
  /** Called by the ✕ (and any consumer action). Swipes never call this. */
  onClose: () => void;
  /** Centered title in the drag header. */
  title: React.ReactNode;
  /** Right-aligned controls in the drag header (Save filter, Share, …). */
  headerActions?: React.ReactNode;
  /** Optional second header row — e.g. a primary action button. */
  headerExtra?: React.ReactNode;
  /** Optional pinned footer below the scrolling body. */
  footer?: React.ReactNode;
  /** The scrolling body. */
  children: React.ReactNode;
  /**
   * `false` keeps the page behind interactive (the map under the
   * add-place sheet). Gestures are identical either way.
   */
  modal?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  headerActions,
  headerExtra,
  footer,
  children,
  modal = true,
  className,
  bodyClassName,
}: BottomSheetProps) {
  const [snapPoint, setSnapPoint] = React.useState<number | string>(
    RESTING_SNAP
  );

  /**
   * base-ui restores the PRE-DRAG detent synchronously right after we
   * cancel a swipe dismiss: DrawerViewport captures the starting snap
   * point, calls onOpenChange (where we cancel), then — seeing the cancel
   * — writes that captured point back via onSnapPointChange. That write
   * lands after ours, so `setSnapPoint(RESTING_SNAP)` alone is a no-op and
   * a flick from FULL springs back to FULL. This one-shot flag swallows
   * exactly that restore so the sheet actually settles at half.
   */
  const swallowRestoreRef = React.useRef(false);

  // Sheets that stay mounted across open/close (FilterSheet) must reopen
  // at half rather than wherever the user last dragged them.
  React.useEffect(() => {
    if (open) setSnapPoint(RESTING_SNAP);
  }, [open]);

  return (
    <Drawer
      open={open}
      snapPoints={SNAP_POINTS}
      snapPoint={snapPoint}
      onSnapPointChange={(next) => {
        // Swallow base-ui's post-cancel restore (see swallowRestoreRef).
        if (swallowRestoreRef.current) {
          swallowRestoreRef.current = false;
          setSnapPoint(RESTING_SNAP);
          return;
        }
        if (next != null) setSnapPoint(next);
      }}
      snapToSequentialPoints
      disablePointerDismissal
      modal={modal}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "swipe") {
          // Never dismiss on a swipe — fall back to the resting detent.
          details.cancel();
          swallowRestoreRef.current = true;
          setSnapPoint(RESTING_SNAP);
          return;
        }
        onClose();
      }}
    >
      <DrawerContent modal={modal} className={className}>
        <DrawerHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-9 w-9 shrink-0 cursor-pointer p-0"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
            <DrawerTitle className="min-w-0 flex-1 truncate text-center">
              {title}
            </DrawerTitle>
            {/* min-w matches the ✕ so the title stays optically centered
                even when a consumer passes no actions. */}
            <div className="flex min-w-9 shrink-0 items-center justify-end gap-1">
              {headerActions}
            </div>
          </div>
          {headerExtra ? <div className="mt-3">{headerExtra}</div> : null}
        </DrawerHeader>

        <DrawerBody
          className={cn(
            "px-0 pb-[env(safe-area-inset-bottom,0px)]",
            bodyClassName
          )}
        >
          {children}
        </DrawerBody>

        {footer ? <DrawerFooter>{footer}</DrawerFooter> : null}
      </DrawerContent>
    </Drawer>
  );
}
