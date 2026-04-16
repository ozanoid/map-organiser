"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";
import type { PlaceFilters } from "@/lib/types";

// URL param name ↔ PlaceFilters property mapping
const PARAM_MAP: Record<string, string> = {
  category_ids: "category",
  tag_ids: "tags",
  list_id: "list",
  rating_min: "rating",
  google_rating_min: "google_rating",
  visit_status: "status",
  search: "q",
  sort: "sort",
};

function paramKeyFor(key: string): string {
  return PARAM_MAP[key] || key;
}

function parseUrlToFilters(searchParams: URLSearchParams): PlaceFilters {
  const category = searchParams.get("category");
  const tagIds = searchParams.get("tags");
  const status = searchParams.get("status");
  return {
    country: searchParams.get("country") || undefined,
    city: searchParams.get("city") || undefined,
    category_ids: category ? category.split(",") : undefined,
    tag_ids: tagIds ? tagIds.split(",") : undefined,
    list_id: searchParams.get("list") || undefined,
    rating_min: searchParams.get("rating")
      ? Number(searchParams.get("rating"))
      : undefined,
    google_rating_min: searchParams.get("google_rating")
      ? Number(searchParams.get("google_rating"))
      : undefined,
    visit_status: (status as PlaceFilters["visit_status"]) || undefined,
    search: searchParams.get("q") || undefined,
    sort: searchParams.get("sort") || undefined,
  };
}

function filtersToQueryString(filters: PlaceFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    const paramKey = paramKeyFor(key);
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(paramKey, value.join(","));
    } else {
      params.set(paramKey, String(value));
    }
  });
  return params.toString();
}

export function useFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Local state — initialized from URL
  const [localFilters, setLocalFilters] = useState<PlaceFilters>(() =>
    parseUrlToFilters(searchParams)
  );

  // Track URL changes for external navigation (back/forward)
  const lastPushedRef = useRef(searchParams.toString());

  useEffect(() => {
    const currentUrl = searchParams.toString();
    if (currentUrl !== lastPushedRef.current) {
      // URL changed externally (back/forward/manual) → sync to local
      lastPushedRef.current = currentUrl;
      setLocalFilters(parseUrlToFilters(searchParams));
    }
  }, [searchParams]);

  // Debounced URL sync (local → URL)
  const syncToUrl = useDebouncedCallback((filters: PlaceFilters) => {
    const query = filtersToQueryString(filters);
    lastPushedRef.current = query;
    const newUrl = query ? `${pathname}?${query}` : pathname;
    router.push(newUrl, { scroll: false });
  }, 300);

  const setFilters = useCallback(
    (newFilters: Partial<PlaceFilters>) => {
      setLocalFilters((prev) => {
        const next = { ...prev };
        Object.entries(newFilters).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") {
            delete (next as Record<string, unknown>)[key];
          } else if (Array.isArray(value) && value.length === 0) {
            delete (next as Record<string, unknown>)[key];
          } else {
            (next as Record<string, unknown>)[key] = value;
          }
        });
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl]
  );

  const clearFilters = useCallback(() => {
    setLocalFilters({});
    lastPushedRef.current = "";
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  const hasActiveFilters = useMemo(() => {
    return Object.values(localFilters).some(
      (v) => v !== undefined && (!Array.isArray(v) || v.length > 0)
    );
  }, [localFilters]);

  return { filters: localFilters, setFilters, clearFilters, hasActiveFilters };
}
