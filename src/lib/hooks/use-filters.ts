"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { PlaceFilters } from "@/lib/types";

export function useFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: PlaceFilters = useMemo(() => {
    const tagIds = searchParams.get("tags");
    return {
      country: searchParams.get("country") || undefined,
      city: searchParams.get("city") || undefined,
      category_id: searchParams.get("category") || undefined,
      tag_ids: tagIds ? tagIds.split(",") : undefined,
      list_id: searchParams.get("list") || undefined,
      rating_min: searchParams.get("rating")
        ? Number(searchParams.get("rating"))
        : undefined,
      search: searchParams.get("q") || undefined,
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (newFilters: Partial<PlaceFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(newFilters).forEach(([key, value]) => {
        const paramKey =
          key === "category_id"
            ? "category"
            : key === "tag_ids"
              ? "tags"
              : key === "rating_min"
                ? "rating"
                : key === "search"
                  ? "q"
                  : key;

        if (value === undefined || value === null || value === "") {
          params.delete(paramKey);
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            params.delete(paramKey);
          } else {
            params.set(paramKey, value.join(","));
          }
        } else {
          params.set(paramKey, String(value));
        }
      });

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [searchParams, router, pathname]
  );

  const clearFilters = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some(
      (v) => v !== undefined && (!Array.isArray(v) || v.length > 0)
    );
  }, [filters]);

  return { filters, setFilters, clearFilters, hasActiveFilters };
}
