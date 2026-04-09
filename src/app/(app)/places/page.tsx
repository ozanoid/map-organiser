"use client";

import { Suspense, useState } from "react";
import { usePlaces } from "@/lib/hooks/use-places";
import { useFilters } from "@/lib/hooks/use-filters";
import { PlaceCard } from "@/components/places/place-card";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Plus, Search, SlidersHorizontal } from "lucide-react";

function PlacesContent() {
  const { filters, setFilters, hasActiveFilters } = useFilters();
  const { data: places = [], isLoading } = usePlaces(filters);
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Places</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden cursor-pointer"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </Button>
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Place
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search places..."
          value={filters.search || ""}
          onChange={(e) => setFilters({ search: e.target.value || undefined })}
          className="pl-9"
        />
      </div>

      {/* Place grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : places.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MapPin className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500 text-sm">
            {hasActiveFilters
              ? "No places match your filters."
              : "No places yet. Add your first place to get started."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {places.map((place) => (
            <PlaceCard key={place.id} place={place} />
          ))}
        </div>
      )}

      <AddPlaceDialog open={addOpen} onOpenChange={setAddOpen} />
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} />
    </div>
  );
}

export default function PlacesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <Skeleton className="h-8 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <PlacesContent />
    </Suspense>
  );
}
