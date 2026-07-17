"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CountryCityFilter } from "./country-city-filter";
import { CategoryFilter } from "./category-filter";
import { VisitStatusFilter } from "./visit-status-filter";
import { OpenNowFilter } from "./open-now-filter";
import { SaveFilterButton } from "./save-filter-button";
import { TagFilter } from "./tag-filter";
import { ListFilter } from "./list-filter";
import { DebouncedSearchInput } from "./debounced-search-input";
import { useFilters } from "@/lib/hooks/use-filters";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";
import { X, Sparkles } from "lucide-react";

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "google_rating_desc", label: "Google rating" },
] as const;

export function FilterSheet({ open, onOpenChange }: FilterSheetProps) {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useFilters();
  const resetAiSearch = useAiSearchStore((s) => s.reset);
  // AI mode (assistant push or saved ✨ chip): rankings drive the order.
  const aiSearchActive = useAiSearchStore((s) => s.rankings !== null);

  // Clear must ALSO reset the AI store (desktop FilterPanel parity):
  // clearFilters alone leaves pushed rankings alive, and the grid keeps
  // hiding/sorting by stale scores — the mobile "clear doesn't clear" bug.
  function handleClearAll() {
    clearFilters();
    resetAiSearch();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[65dvh] rounded-t-2xl flex flex-col" showCloseButton={false}>
        <SheetHeader className="flex flex-row items-center justify-between shrink-0 px-5 pb-0">
          <SheetTitle>Filters</SheetTitle>
          <div className="flex items-center gap-2">
            <SaveFilterButton />
            {(hasActiveFilters || aiSearchActive) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="cursor-pointer text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer text-xs"
            >
              Done
            </Button>
          </div>
        </SheetHeader>

        <div className="overflow-y-auto flex-1 px-5 pb-safe-area-inset-bottom" style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>
          {/* Sort — replaced by a static badge while AI rankings drive
              the order (desktop FilterPanel parity: changing sort would
              be a confusing no-op against the semantic ordering). */}
          <div className="pt-2 pb-4">
            <label className="text-sm font-medium mb-2 block">Sort by</label>
            {aiSearchActive ? (
              <div className="flex items-center gap-1.5 h-10 px-3 text-sm rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                AI Ranked
              </div>
            ) : (
              <div className="relative">
                <select
                  value={filters.sort || "newest"}
                  onChange={(e) =>
                    setFilters({ sort: e.target.value === "newest" ? undefined : e.target.value })
                  }
                  className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors duration-200"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <svg
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* Visit Status */}
          <div className="pt-2 pb-4">
            <label className="text-sm font-medium mb-2 block">Status</label>
            <VisitStatusFilter />
          </div>

          <div className="border-t" />

          {/* Open now (v1.18.0) */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Hours</label>
            <OpenNowFilter />
          </div>

          <div className="border-t" />

          {/* Search */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Search</label>
            <DebouncedSearchInput
              value={filters.search}
              onSearch={(search) => setFilters({ search })}
            />
          </div>

          <div className="border-t" />

          {/* Country / City */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Location</label>
            <CountryCityFilter
              country={filters.country}
              city={filters.city}
              onCountryChange={(country) => setFilters({ country, city: undefined })}
              onCityChange={(city) => setFilters({ city })}
            />
          </div>

          <div className="border-t" />

          {/* Category */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Category</label>
            <CategoryFilter
              selected={filters.category_ids}
              onChange={(category_ids) => setFilters({ category_ids })}
              selectedSubcategories={filters.subcategory_ids}
              onSubcategoryChange={(subcategory_ids) =>
                setFilters({ subcategory_ids })
              }
            />
          </div>

          <div className="border-t" />

          {/* Tags */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Tags</label>
            <TagFilter />
          </div>

          <div className="border-t" />

          {/* List */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">List</label>
            <ListFilter />
          </div>

          <div className="border-t" />

          {/* My Rating */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">My rating (min)</label>
            <SheetRatingStars
              value={filters.rating_min || 0}
              onChange={(v) => setFilters({ rating_min: v || undefined })}
            />
          </div>

          <div className="border-t" />

          {/* Google Rating */}
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Google rating (min)</label>
            <SheetRatingStars
              value={filters.google_rating_min || 0}
              onChange={(v) => setFilters({ google_rating_min: v || undefined })}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SheetRatingStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? 0 : star)}
          className="cursor-pointer p-0.5"
        >
          <svg
            className={`h-7 w-7 ${
              star <= value
                ? "fill-orange-400 text-orange-400"
                : "fill-none text-gray-300 dark:text-gray-600"
            }`}
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
