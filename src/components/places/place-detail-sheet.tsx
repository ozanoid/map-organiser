"use client";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { PlaceDetailView } from "@/components/places/place-detail-view";

/**
 * Mobile bottom-sheet wrapper around the full PlaceDetailView (v1.24.0
 * experiment): tapping a saved place opens its full detail in a sheet on
 * the current page instead of navigating to `/places/[id]`. Wired from
 * the Places grid cards and the map marker detail on mobile; desktop
 * keeps its existing navigation / side-panel.
 *
 * Structure and gestures come from the shared `BottomSheet` — opens at
 * half, the whole header drags, swiping down never closes, only the ✕
 * does — so this panel behaves identically to the filter and add-place
 * sheets. The name is passed in (rather than waiting on the view's
 * fetch) so the drag header is populated immediately.
 */
export function PlaceDetailSheet({
  placeId,
  placeName,
  onClose,
}: {
  placeId: string;
  placeName: string;
  onClose: () => void;
}) {
  return (
    <BottomSheet open onClose={onClose} title={placeName}>
      <PlaceDetailView
        placeId={placeId}
        variant="sheet"
        onBack={onClose}
        onDeleted={onClose}
      />
    </BottomSheet>
  );
}
