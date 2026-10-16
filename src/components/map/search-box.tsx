"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, Loader2, MapPin } from "lucide-react";
import { usePlaceSearch } from "@/lib/hooks/use-place-search";
import type { RetrievedPlaceData } from "@/lib/hooks/use-place-search";
import type { SearchSuggestion } from "@/lib/mapbox/search-box";

export interface SearchBoxHandle {
  /** Fill the box with `text`, open the suggestions and focus it — used by the
   *  Instagram import's "Search" / "Search manually". `proximity` keeps this
   *  search within ~30 km of the post's area until the box is cleared. */
  search: (text: string, opts?: { proximity?: { lng: number; lat: number } | null }) => void;
}

/** About 30 km each way — a city and its suburbs. */
function boxAround(p: { lng: number; lat: number }): [number, number, number, number] {
  const dLat = 0.27;
  const dLng = dLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
  return [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat];
}

interface SearchBoxProps {
  /** Viewport center for proximity bias. */
  proximity?: { lng: number; lat: number };
  /** Fired when the user picks a suggestion and the retrieve completes. */
  onSelect: (place: RetrievedPlaceData) => void;
  className?: string;
  ref?: Ref<SearchBoxHandle>;
}

/**
 * Search-on-map overlay (Mapbox Search Box client).
 *
 * - Input expands inline; suggestions in an absolute dropdown.
 * - Debounced via `usePlaceSearch` (300ms).
 * - On select, hides the dropdown and delegates retrieved data to parent.
 */
export function SearchBox({ proximity, onSelect, className, ref }: SearchBoxProps) {
  const [aimedAt, setAimedAt] = useState<{ lng: number; lat: number } | null>(null);
  const { query, setQuery, suggestions, isSearching, retrieve, isRetrieving, clear } =
    usePlaceSearch(
      // An aimed search stays in that city: proximity alone only ranks, and a
      // strong name match on another continent still comes first.
      aimedAt ? { proximity: aimedAt, bbox: boxAround(aimedAt) } : { proximity }
    );
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      search: (text, opts) => {
        setAimedAt(opts?.proximity ?? null);
        setQuery(text);
        setOpen(true);
        inputRef.current?.focus();
      },
    }),
    [setQuery]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  async function handleSelect(s: SearchSuggestion) {
    setOpen(false);
    try {
      const data = await retrieve(s.mapbox_id);
      onSelect(data);
      clear();
      setAimedAt(null);
    } catch {
      // Hook surfaces error; just keep input intact
    }
  }

  function handleClear() {
    clear();
    setAimedAt(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="bg-white dark:bg-gray-900 shadow-md rounded-full flex items-center pl-3 pr-1 h-10 border border-gray-200 dark:border-gray-800">
        {isSearching || isRetrieving ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search places…"
          className="border-0 shadow-none focus-visible:ring-0 h-8 bg-transparent text-base md:text-sm flex-1 min-w-0"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-8 w-8 p-0 cursor-pointer rounded-full"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border rounded-xl shadow-xl max-h-80 overflow-y-auto z-20">
          {suggestions.map((s) => (
            <button
              key={s.mapbox_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-start gap-2.5 border-b last:border-b-0 border-gray-100 dark:border-gray-800"
            >
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{s.name}</p>
                {(s.place_formatted || s.full_address) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {s.place_formatted || s.full_address}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.trim().length >= 2 && !isSearching && suggestions.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-900 border rounded-xl shadow-xl z-20 px-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">No places found.</p>
        </div>
      )}
    </div>
  );
}
