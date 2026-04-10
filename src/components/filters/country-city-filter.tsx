"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  const countries = [...new Set(locations.map((l) => l.country).filter((c): c is string => !!c))].sort();
  const cities = country
    ? [...new Set(
        locations
          .filter((l) => l.country === country)
          .map((l) => l.city)
          .filter((c): c is string => !!c)
      )].sort()
    : [];

  return (
    <div className="space-y-2">
      <Select
        value={country || "__all__"}
        onValueChange={(v) => {
          onCountryChange(!v || v === "__all__" ? undefined : v);
          onCityChange(undefined);
        }}
      >
        <SelectTrigger className="cursor-pointer">
          <SelectValue placeholder="All countries">
            {country || "All countries"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__" className="cursor-pointer">All countries</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c} value={c} className="cursor-pointer">
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {country && cities.length > 0 && (
        <Select
          value={city || "__all__"}
          onValueChange={(v) => onCityChange(!v || v === "__all__" ? undefined : v)}
        >
          <SelectTrigger className="cursor-pointer">
            <SelectValue placeholder="All cities">
              {city || "All cities"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="cursor-pointer">All cities</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c} className="cursor-pointer">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
