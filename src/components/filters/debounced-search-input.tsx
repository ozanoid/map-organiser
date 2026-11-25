"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";

interface DebouncedSearchInputProps {
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
  /** The field's door to the assistant (Phase 2, decision 6.1): while there
   *  is text, a row under the field hands it over. The words leave the field
   *  — they are the assistant's question now, not a keyword filter. */
  onAsk?: (text: string) => void;
}

export function DebouncedSearchInput({
  value: externalValue,
  onSearch,
  placeholder = "Search places...",
  className,
  onAsk,
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
        type="search"
        inputMode="search"
        enterKeyHint="search"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          debouncedSearch(e.target.value);
        }}
        className="pl-9"
      />
      {onAsk && localValue.trim().length >= 2 && (
        <button
          type="button"
          onClick={() => {
            const text = localValue.trim();
            debouncedSearch.cancel();
            setLocalValue("");
            onSearch(undefined);
            onAsk(text);
          }}
          className="mt-1.5 flex min-h-9 w-full items-center gap-1.5 rounded-md border border-emerald-200 px-2.5 py-1.5 text-left text-sm text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Ask the assistant</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      )}
    </div>
  );
}
