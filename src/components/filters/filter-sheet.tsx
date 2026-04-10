"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CountryCityFilter } from "./country-city-filter";
import { CategoryFilter } from "./category-filter";
import { VisitStatusFilter } from "./visit-status-filter";
import { TagFilter } from "./tag-filter";
import { ListFilter } from "./list-filter";
import { useFilters } from "@/lib/hooks/use-filters";
import { Search, X } from "lucide-react";

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilterSheet({ open, onOpenChange }: FilterSheetProps) {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useFilters();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[65dvh] rounded-t-2xl flex flex-col">
        <SheetHeader className="flex flex-row items-center justify-between shrink-0">
          <SheetTitle>Filters</SheetTitle>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
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

        <div className="space-y-6 mt-4 overflow-y-auto flex-1 pb-safe-area-inset-bottom" style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>
          {/* Visit Status */}
          <div>
            <label className="text-sm font-medium mb-2 block">Status</label>
            <VisitStatusFilter />
          </div>

          {/* Search */}
          <div>
            <label className="text-sm font-medium mb-2 block">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search places..."
                value={filters.search || ""}
                onChange={(e) => setFilters({ search: e.target.value || undefined })}
                className="pl-9"
              />
            </div>
          </div>

          {/* Country / City */}
          <div>
            <label className="text-sm font-medium mb-2 block">Location</label>
            <CountryCityFilter
              country={filters.country}
              city={filters.city}
              onCountryChange={(country) => setFilters({ country })}
              onCityChange={(city) => setFilters({ city })}
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium mb-2 block">Category</label>
            <CategoryFilter
              selected={filters.category_id}
              onChange={(category_id) => setFilters({ category_id })}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium mb-2 block">Tags</label>
            <TagFilter />
          </div>

          {/* List */}
          <div>
            <label className="text-sm font-medium mb-2 block">List</label>
            <ListFilter />
          </div>

          {/* My Rating */}
          <div>
            <label className="text-sm font-medium mb-2 block">My rating (min)</label>
            <SheetRatingStars
              value={filters.rating_min || 0}
              onChange={(v) => setFilters({ rating_min: v || undefined })}
            />
          </div>

          {/* Google Rating */}
          <div>
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
                : "fill-none text-gray-300"
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
