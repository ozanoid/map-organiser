"use client";

import { useQuery } from "@tanstack/react-query";

export interface StatsData {
  hero: { total: number; countries: number; cities: number; avgRating: number };
  visitStatus: Record<string, number>;
  byCategory: Array<{ name: string; color: string; count: number }>;
  topCities: Array<{ city: string; count: number }>;
  monthlyTrend: Array<{ month: string; count: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
}

export function useStats() {
  return useQuery<StatsData>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
