"use client";

import {
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerTitle,
} from "@/components/ui/drawer";
import { PlaceDetailView } from "@/components/places/place-detail-view";

/**
 * Mobile bottom-sheet wrapper around the full PlaceDetailView (v1.24.0
 * experiment): tapping a saved place opens its full detail in a
 * half-height Drawer on the current page instead of navigating to
 * `/places/[id]`. Wired from the Places grid cards and the map marker
 * detail on mobile; desktop keeps its existing navigation / side-panel.
 *
 * A read-and-edit view (no swipe-guard): opens at half, drag up to full,
 * swipe-down / backdrop / the header ✕ all close it. The view's own back
 * control renders as ✕ and calls onClose (variant="sheet").
 */
export function PlaceDetailSheet({
  placeId,
  onClose,
}: {
  placeId: string;
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      snapPoints={[0.5, 0.92]}
    >
      <DrawerContent>
        {/* a11y name for the role=dialog sheet (the view renders its own
            visible title row). */}
        <DrawerTitle className="sr-only">Place details</DrawerTitle>
        <DrawerBody className="px-0">
          <PlaceDetailView
            placeId={placeId}
            variant="sheet"
            onBack={onClose}
            onDeleted={onClose}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
