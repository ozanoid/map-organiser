"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePlaces } from "@/lib/hooks/use-places";
import { useDeleteList } from "@/lib/hooks/use-lists";
import { MapView } from "@/components/map/map-view";
import { PlaceCard } from "@/components/places/place-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Trash2, Map, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import type { PlaceList } from "@/lib/types";

export default function ListDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [list, setList] = useState<PlaceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "map">("grid");
  const deleteList = useDeleteList();

  const { data: places = [] } = usePlaces({ list_id: params.id as string });

  useEffect(() => {
    supabase
      .from("lists")
      .select("*")
      .eq("id", params.id)
      .single()
      .then(({ data }) => {
        setList(data);
        setLoading(false);
      });
  }, [params.id, supabase]);

  function handleDelete() {
    if (!confirm("Delete this list? Places won't be deleted.")) return;
    deleteList.mutate(params.id as string, {
      onSuccess: () => {
        toast.success("List deleted");
        router.push("/lists");
      },
    });
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!list) {
    return <div className="p-6"><p className="text-muted-foreground">List not found.</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">{list.name}</h1>
          <span className="text-xs text-muted-foreground">
            {places.length} place{places.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 cursor-pointer"
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "map" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 cursor-pointer"
            onClick={() => setView("map")}
          >
            <Map className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer text-red-500"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {view === "map" ? (
        <div className="flex-1">
          <MapView places={places} className="w-full h-full" />
        </div>
      ) : (
        <div className="p-4 overflow-y-auto flex-1">
          {places.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No places in this list yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {places.map((place) => (
                <PlaceCard key={place.id} place={place} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
