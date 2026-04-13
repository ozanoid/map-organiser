"use client";

import { Suspense, useCallback, useState } from "react";
import { usePlaces } from "@/lib/hooks/use-places";
import { useFilters } from "@/lib/hooks/use-filters";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { BulkActionBar } from "@/components/places/bulk-action-bar";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { FilterPanel } from "@/components/filters/filter-panel";
import { Button } from "@/components/ui/button";
import { DebouncedSearchInput } from "@/components/filters/debounced-search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Plus, SlidersHorizontal, CheckSquare, Square } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VisitStatusBadge } from "@/components/places/visit-status-toggle";
import { Star, ExternalLink } from "lucide-react";
import type { Place } from "@/lib/types";

function SelectablePlaceCard({
  place,
  isSelected,
  onToggle,
}: {
  place: Place;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const googlePhoto = place.google_data?.photo_storage_url || place.google_data?.photos?.[0];
  const googleRating = place.google_data?.rating;
  const tags = place.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const extraTagCount = tags.length - 2;

  return (
    <div className="relative">
      {/* Selection checkbox */}
      <label
        className="absolute top-2 left-2 z-10 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="sr-only"
        />
        <div
          className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "bg-white/80 border-gray-300 hover:border-gray-400"
          }`}
        >
          {isSelected && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </label>

      <Link href={`/places/${place.id}`} prefetch={false}>
        <Card
          className={`overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
            isSelected ? "ring-2 ring-emerald-500" : ""
          }`}
        >
          {googlePhoto && (
            <div className="relative h-32 bg-gray-100">
              <img
                src={googlePhoto}
                alt={place.name}
                className="w-full h-full object-cover"
              />
              {place.visit_status && (
                <div className="absolute top-2 right-2">
                  <VisitStatusBadge status={place.visit_status} />
                </div>
              )}
            </div>
          )}

          {!googlePhoto && place.visit_status && (
            <div className="flex justify-end px-3 pt-2">
              <VisitStatusBadge status={place.visit_status} />
            </div>
          )}

          <div className="p-3 space-y-1.5">
            <h3 className="font-medium text-sm line-clamp-1">{place.name}</h3>

            {place.address && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {place.address}
              </p>
            )}

            {visibleTags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {visibleTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {tag.name}
                  </Badge>
                ))}
                {extraTagCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{extraTagCount}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {place.category && (
                <Badge
                  variant="secondary"
                  className="text-[10px] gap-1 px-1.5 py-0"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: place.category.color }}
                  />
                  {place.category.name}
                </Badge>
              )}

              {place.rating && (
                <span className="flex items-center gap-0.5 text-xs text-orange-500">
                  <Star className="h-3 w-3 fill-current" />
                  {place.rating}
                </span>
              )}

              {googleRating && !place.rating && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-gray-300 text-gray-300" />
                  {googleRating}
                </span>
              )}

              {googleRating && place.rating && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  G: {googleRating}
                </span>
              )}

              {place.country && (
                <span className="text-[10px] text-muted-foreground">
                  {place.city
                    ? `${place.city}, ${place.country}`
                    : place.country}
                </span>
              )}

              {place.google_data?.url && (
                <a
                  href={place.google_data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 hover:underline ml-auto"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Maps
                </a>
              )}
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
}

function PlacesContent() {
  const { filters, setFilters, hasActiveFilters } = useFilters();
  const { data: places = [], isLoading } = usePlaces(filters);
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allSelected = places.length > 0 && places.every((p) => selectedIds.has(p.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(places.map((p) => p.id)));
    }
  }, [allSelected, places]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return (
    <div className="flex">
      {/* Desktop filter sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r p-4 overflow-y-auto h-[calc(100vh-3.5rem)]">
        <FilterPanel />
      </aside>

      <div className="flex-1 p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Places</h1>
          {places.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              title={allSelected ? "Deselect All" : "Select All"}
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {allSelected ? "Deselect All" : "Select All"}
              </span>
            </button>
          )}
        </div>
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
      <div className="max-w-sm">
        <DebouncedSearchInput
          value={filters.search}
          onSearch={(search) => setFilters({ search })}
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
            <SelectablePlaceCard
              key={place.id}
              place={place}
              isSelected={selectedIds.has(place.id)}
              onToggle={() => toggleSelect(place.id)}
            />
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          onClear={clearSelection}
          onComplete={clearSelection}
        />
      )}

      <AddPlaceDialog open={addOpen} onOpenChange={setAddOpen} />
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} />
      </div>
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
