"use client";

import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useFilters, filtersToQueryString } from "@/lib/hooks/use-filters";
import { useCreateSavedFilter } from "@/lib/hooks/use-saved-filters";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";

/**
 * v1.20.0 (F-03) — "save the current filter set" popover, mounted in the
 * filter panel + mobile sheet headers next to Clear (same
 * hasActiveFilters gate — saving an empty set is meaningless).
 *
 * Serializes via filtersToQueryString(filters) so the stored string is
 * canonical (same serializer the URL sync uses). When an AI search is
 * active (rankings present), the NL query is stored too, so the
 * resulting chip re-runs the whole AI pipeline.
 */
export function SaveFilterButton() {
  const { filters, hasActiveFilters } = useFilters();
  const createSavedFilter = useCreateSavedFilter();
  const aiActive = useAiSearchStore((s) => s.rankings !== null);
  const lastQuery = useAiSearchStore((s) => s.lastQuery);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (!hasActiveFilters) return null;

  function handleSave() {
    const trimmed = name.trim();
    // Enter in the input also lands here — guard in-flight, not just the button
    if (!trimmed || createSavedFilter.isPending) return;
    createSavedFilter.mutate(
      {
        name: trimmed,
        query_string: filtersToQueryString(filters),
        ai_query: aiActive && lastQuery ? lastQuery : null,
      },
      {
        onSuccess: () => {
          toast.success(`"${trimmed}" saved`);
          setName("");
          setOpen(false);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Failed to save"),
      }
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors h-7">
        <BookmarkPlus className="h-3 w-3" />
        Save
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 space-y-2">
        <p className="text-xs font-medium">
          {aiActive && lastQuery ? "Save this AI search" : "Save this filter"}
        </p>
        {aiActive && lastQuery && (
          <p className="text-[11px] text-muted-foreground line-clamp-2">
            “{lastQuery}” — the chip will re-run the AI search.
          </p>
        )}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. London date spots)"
          maxLength={40}
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!name.trim() || createSavedFilter.isPending}
          className="cursor-pointer w-full h-8 text-xs gap-1.5"
        >
          {createSavedFilter.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <BookmarkPlus className="h-3 w-3" />
          )}
          Save filter
        </Button>
      </PopoverContent>
    </Popover>
  );
}
