"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface CountryCityFilterProps {
  country?: string;
  city?: string;
  onCountryChange: (country: string | undefined) => void;
  onCityChange: (city: string | undefined) => void;
}

export function CountryCityFilter({
  country,
  city,
  onCountryChange,
  onCityChange,
}: CountryCityFilterProps) {
  const supabase = createClient();

  const { data: locations = [] } = useQuery({
    queryKey: ["user-locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("places")
        .select("country, city")
        .not("country", "is", null);
      return data || [];
    },
  });

  const countries = [
    ...new Set(
      locations.map((l) => l.country).filter((c): c is string => !!c)
    ),
  ].sort();
  const cities = country
    ? [
        ...new Set(
          locations
            .filter((l) => l.country === country)
            .map((l) => l.city)
            .filter((c): c is string => !!c)
        ),
      ].sort()
    : [];

  return (
    <div className="space-y-2">
      {/* Country */}
      <div className="relative">
        <select
          value={country || ""}
          onChange={(e) => {
            onCountryChange(e.target.value || undefined);
          }}
          className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
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
        {country && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-7 top-1/2 -translate-y-1/2 h-5 w-5 p-0 cursor-pointer z-10"
            onClick={(e) => {
              e.stopPropagation();
              onCountryChange(undefined);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* City */}
      {country && cities.length > 0 && (
        <div className="relative">
          <select
            value={city || ""}
            onChange={(e) => onCityChange(e.target.value || undefined)}
            className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
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
  );
}
