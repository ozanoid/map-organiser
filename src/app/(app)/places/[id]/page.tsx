"use client";

import { useParams, useRouter } from "next/navigation";
import { PlaceDetailView } from "@/components/places/place-detail-view";

/**
 * Route wrapper — the full detail body lives in the shared
 * `PlaceDetailView` (also used by the mobile PlaceDetailSheet). This
 * page just supplies the route id and wires back/delete to navigation.
 */
export default function PlaceDetailPage() {
  const params = useParams();
  const router = useRouter();

  return (
    <PlaceDetailView
      placeId={params.id as string}
      onBack={() => router.back()}
      onDeleted={() => router.push("/places")}
    />
  );
}
