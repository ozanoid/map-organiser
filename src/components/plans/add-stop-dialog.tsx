"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePlaces } from "@/lib/hooks/use-places";
import type { PlanDay } from "@/lib/types";
import { usePlanEditor } from "./use-plan-editor";

const MAX_SHOWN = 50;

/**
 * Adds a stop to a day: one of the saved places, or — for a meeting point
 * or anything that isn't a saved place — the typed text itself.
 */
export function AddStopDialog({
  planId,
  day,
  placeIdsInDay,
  open,
  onOpenChange,
}: {
  planId: string;
  day: Pick<PlanDay, "id" | "day_number">;
  placeIdsInDay: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: allPlaces = [], isLoading } = usePlaces({});
  const { apply, isPending } = usePlanEditor(planId);
  const [search, setSearch] = useState("");

  const query = search.trim();
  const needle = query.toLowerCase();
  const matches = allPlaces.filter((p) => {
    if (placeIdsInDay.includes(p.id)) return false;
    if (!needle) return true;
    return p.name.toLowerCase().includes(needle) || !!p.address?.toLowerCase().includes(needle);
  });

  function add(stop: { place_id: string } | { title: string }, label: string) {
    apply(
      { ops: [{ op: "add_stop", day_id: day.id, ...stop }] },
      {
        onDone: () => {
          toast.success(`Added ${label}`);
          onOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a stop to Day {day.day_number}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search your places, or type a stop"
            aria-label="Search your places, or type a stop"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={160}
            className="h-10 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div className="-mx-4 flex-1 overflow-y-auto px-4">
          <div className="space-y-0.5">
            {matches.slice(0, MAX_SHOWN).map((place) => (
              <button
                key={place.id}
                type="button"
                disabled={isPending}
                onClick={() => add({ place_id: place.id }, place.name)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full"
                  style={{ backgroundColor: place.category?.color || "#6B7280" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{place.name}</p>
                  {place.address && (
                    <p className="truncate text-[11px] text-muted-foreground">{place.address}</p>
                  )}
                </div>
                {place.category && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {place.category.name}
                  </Badge>
                )}
              </button>
            ))}
            {matches.length > MAX_SHOWN && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                Showing {MAX_SHOWN} of {matches.length} — type to narrow down.
              </p>
            )}
            {matches.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {isLoading ? "Loading your places…" : needle ? "No saved place matches." : "No places to add."}
              </p>
            )}
            {query && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => add({ title: query }, `“${query}”`)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">Add “{query}”</p>
                  <p className="text-[11px] text-muted-foreground">
                    A stop without a saved place — a meeting point, a note
                  </p>
                </div>
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
