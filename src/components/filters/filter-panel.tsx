"use client";

import { Button } from "@/components/ui/button";
import { CountryCityFilter } from "./country-city-filter";
import { CategoryFilter } from "./category-filter";
import { VisitStatusFilter } from "./visit-status-filter";
import { OpenNowFilter } from "./open-now-filter";
import { SaveFilterButton } from "./save-filter-button";
import { TagFilter } from "./tag-filter";
import { ListFilter } from "./list-filter";
import { DebouncedSearchInput } from "./debounced-search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname } from "next/navigation";
import { useAskFromSearch } from "@/components/assistant/ask-assistant";
import { useFilters } from "@/lib/hooks/use-filters";
import { X } from "lucide-react";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "google_rating_desc", label: "Google rating" },
] as const;

export function FilterPanel() {
  const { filters, setFilters, clearFilters, hasActiveFilters } = useFilters();
  const askAssistant = useAskFromSearch(usePathname() === "/map" ? "map" : "places");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filters</h3>
        <div className="flex items-center gap-1">
          {/* Save = only meaningful with active filters (same gate as
              Clear, enforced inside the component). */}
          <SaveFilterButton />
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="cursor-pointer text-xs h-7 px-2"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Sort by
        </label>
        <div>
          <Select
            items={SORT_OPTIONS}
            value={filters.sort || "newest"}
            onValueChange={(v) =>
              setFilters({ sort: v === "newest" ? undefined : (v as string) })
            }
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Visit Status */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Status
        </label>
        <VisitStatusFilter />
      </div>

      {/* Open now (v1.18.0 — dynamic, place-local time) */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Hours
        </label>
        <OpenNowFilter />
      </div>

      {/* Search */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Search
        </label>
        <DebouncedSearchInput
          value={filters.search}
          onSearch={(search) => setFilters({ search })}
          onAsk={askAssistant}
        />
      </div>

      {/* Country / City */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Location
        </label>
        <CountryCityFilter
          country={filters.country}
          city={filters.city}
          onCountryChange={(country) => setFilters({ country, city: undefined })}
          onCityChange={(city) => setFilters({ city })}
        />
      </div>

      {/* Category */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Category
        </label>
        <CategoryFilter
          selected={filters.category_ids}
          onChange={(category_ids) => setFilters({ category_ids })}
          selectedSubcategories={filters.subcategory_ids}
          onSubcategoryChange={(subcategory_ids) =>
            setFilters({ subcategory_ids })
          }
        />
      </div>

      {/* Tags */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Tags
        </label>
        <TagFilter />
      </div>

      {/* List */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          List
        </label>
        <ListFilter />
      </div>

      {/* My Rating */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          My rating (min)
        </label>
        <RatingStars
          value={filters.rating_min || 0}
          onChange={(v) => setFilters({ rating_min: v || undefined })}
        />
      </div>

      {/* Google Rating */}
      <div>
        <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
          Google rating (min)
        </label>
        <RatingStars
          value={filters.google_rating_min || 0}
          onChange={(v) => setFilters({ google_rating_min: v || undefined })}
        />
      </div>
    </div>
  );
}

function RatingStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? 0 : star)}
          className="cursor-pointer p-0.5"
        >
          <svg
            className={`h-6 w-6 ${
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
