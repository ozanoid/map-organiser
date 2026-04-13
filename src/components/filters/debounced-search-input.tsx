"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";

interface DebouncedSearchInputProps {
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
}

export function DebouncedSearchInput({
  value: externalValue,
  onSearch,
  placeholder = "Search places...",
  className,
}: DebouncedSearchInputProps) {
  const [localValue, setLocalValue] = useState(externalValue || "");

  // URL → local sync (navigasyon, clear, geri butonu)
  useEffect(() => {
    setLocalValue(externalValue || "");
  }, [externalValue]);

  const debouncedSearch = useDebouncedCallback((val: string) => {
    onSearch(val || undefined);
  }, 400);

  return (
    <div className={`relative ${className || ""}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          debouncedSearch(e.target.value);
        }}
        className="pl-9"
      />
    </div>
  );
}
