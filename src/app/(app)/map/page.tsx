"use client";

import { Suspense, useState } from "react";
import { MapView } from "@/components/map/map-view";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { usePlaces } from "@/lib/hooks/use-places";
import { useFilters } from "@/lib/hooks/use-filters";
import { SlidersHorizontal, Plus } from "lucide-react";

function MapContent() {
  const { filters, hasActiveFilters } = useFilters();
  const { data: places = [], isLoading } = usePlaces(filters);
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="relative h-full">
      <MapView places={places} className="w-full h-full" />

      {/* Floating action buttons */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-md cursor-pointer lg:hidden"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4 mr-1.5" />
          Filters
          {hasActiveFilters && (
            <span className="ml-1.5 h-2 w-2 rounded-full bg-emerald-500" />
          )}
        </Button>
      </div>

      <div className="absolute bottom-20 right-4 z-10 lg:bottom-6">
        <Button
          size="lg"
          className="rounded-full shadow-lg h-14 w-14 cursor-pointer"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Place count badge */}
      {!isLoading && places.length > 0 && (
        <div className="absolute top-4 right-16 z-10 lg:right-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-md text-sm font-medium text-gray-700">
            {places.length} place{places.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      <AddPlaceDialog open={addOpen} onOpenChange={setAddOpen} />
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} />
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-full" />}>
      <MapContent />
    </Suspense>
  );
}
