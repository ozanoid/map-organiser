import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";
import { MapContent } from "@/components/map/map-content";

export default async function MapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (user) {
    const keys = await getUserApiKeys(user.id);
    if (keys.mapboxToken) mapboxToken = keys.mapboxToken;
  }

  return (
    <Suspense fallback={<Skeleton className="w-full h-full" />}>
      <MapContent mapboxToken={mapboxToken} />
    </Suspense>
  );
}
