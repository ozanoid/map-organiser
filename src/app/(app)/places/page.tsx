"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePlaces } from "@/lib/hooks/use-places";
import { useFilters } from "@/lib/hooks/use-filters";
import { useAiRerankOrchestrator } from "@/lib/hooks/use-ai-search";
import { useFilterPersistStore } from "@/lib/stores/filter-persist-store";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { BulkActionBar } from "@/components/places/bulk-action-bar";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { FilterPanel } from "@/components/filters/filter-panel";
import { Button } from "@/components/ui/button";
import { DebouncedSearchInput } from "@/components/filters/debounced-search-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin,
  Plus,
  SlidersHorizontal,
  CheckSquare,
  Square,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
import { PlaceCard } from "@/components/places/place-card";
import {
  useAiSearchStore,
  HIDE_BELOW_SCORE,
} from "@/lib/stores/ai-search-store";
import type { Place } from "@/lib/types";

/**
 * Wrapper that overlays a selection checkbox + ring on the canonical
 * PlaceCard. The visual representation of a place stays in PlaceCard;
 * selection state is layered on top.
 *
 * AI mode hide: PlaceCard returns null when its score is below the
 * hide threshold. We mirror that here so the wrapper div doesn't
 * remain as an empty slot in the grid.
 */
function SelectablePlaceCard({
  place,
  isSelected,
  onToggle,
}: {
  place: Place;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const aiRanking = useAiSearchStore((s) => s.rankings?.get(place.id));
  if (aiRanking !== undefined && aiRanking.score < HIDE_BELOW_SCORE) {
    return null;
  }

  return (
    <div className="relative">
      {/* Selection checkbox — absolute overlay, click stops bubbling to Link */}
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
              : "bg-white/80 dark:bg-gray-800/80 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
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

      <PlaceCard
        place={place}
        className={isSelected ? "ring-2 ring-emerald-500" : ""}
      />
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "google_rating_desc", label: "Google rating" },
] as const;

function PlacesContent() {
  const { filters, setFilters, hasActiveFilters } = useFilters();
  const { data: places = [], isLoading, isFetching } = usePlaces(filters);
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drive the AI rerank pipeline from this page too. AISearchInput lives
  // in FilterPanel and is mounted on BOTH /map and /places — without the
  // orchestrator mounted here, submitting a search on /places sets
  // rerankStatus="pending" and then gets stuck because nothing fires
  // the rank-results call. (Until v1.8.7 the orchestrator was only
  // mounted in MapContent, so AI search on /places hung forever.)
  useAiRerankOrchestrator(filters);

  // Mirror current URL query string into the cross-page filter-persist
  // store so nav links from non-filter-context pages can restore it on
  // return. See filter-persist-store docstring for the round-trip
  // scenario this prevents (v1.8.8).
  const searchParams = useSearchParams();
  const setLastMapPlacesQuery = useFilterPersistStore(
    (s) => s.setLastMapPlacesQuery
  );
  useEffect(() => {
    setLastMapPlacesQuery(searchParams.toString());
  }, [searchParams, setLastMapPlacesQuery]);

  // AI mode awareness: when rankings exist, the grid is sorted by score
  // (desc) and the sort dropdown is disabled. SelectablePlaceCard
  // already hides individual cards below the threshold.
  const aiRankings = useAiSearchStore((s) => s.rankings);
  const aiActive = aiRankings !== null;
  const sortedPlaces = aiActive
    ? [...places].sort((a, b) => {
        const sa = aiRankings.get(a.id)?.score ?? -1;
        const sb = aiRankings.get(b.id)?.score ?? -1;
        return sb - sa;
      })
    : places;

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
      <aside className="hidden lg:block w-64 shrink-0 border-r p-4 overflow-y-auto h-[calc(100dvh-3.5rem)]">
        <FilterPanel />
      </aside>

      <div className="flex-1 min-w-0 p-4 lg:p-6 space-y-4 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Places</h1>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["places"] })}
            className="p-1.5 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Refresh places"
            aria-label="Refresh places"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
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

      {/* Search + Sort */}
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-sm">
          <DebouncedSearchInput
            value={filters.search}
            onSearch={(search) => setFilters({ search })}
          />
        </div>
        <div className="relative shrink-0">
          <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          {aiActive ? (
            // AI search active: sort is dictated by rerank score. The
            // dropdown is replaced with a static badge so the user
            // sees why their sort choice is suspended.
            <div
              className="h-9 pl-8 pr-3 text-sm border border-input rounded-md bg-muted/40 inline-flex items-center text-muted-foreground cursor-not-allowed select-none"
              title="Sorting is controlled by AI ranking while AI search is active"
              aria-label="Sort: AI ranked (disabled)"
            >
              AI Ranked
            </div>
          ) : (
            <>
              <select
                value={filters.sort || "newest"}
                onChange={(e) =>
                  setFilters({
                    sort:
                      e.target.value === "newest"
                        ? undefined
                        : e.target.value,
                  })
                }
                className="h-9 pl-8 pr-7 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors duration-200"
                aria-label="Sort places"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </>
          )}
        </div>
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
          {sortedPlaces.map((place) => (
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
