"use client";

import type { ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subjectLabel, type ResolvedSubject, type SubjectViewFilters } from "@/lib/agent/ui-types";
import { useAssistantAvailability } from "@/lib/hooks/use-assistant-availability";
import { useFilters } from "@/lib/hooks/use-filters";
import { cn } from "@/lib/utils";
import { useAssistantStore, type AssistantRequest } from "@/lib/stores/assistant-store";
import { useMapAreaStore } from "@/lib/stores/map-area-store";

/**
 * A screen's door to the assistant (Phase 2, decision 6.1): opens the panel
 * with the request written and what it is about attached. `request` runs on
 * click, so it reads the screen as it is then. Renders nothing when the
 * assistant can't be used (useAssistantAvailability) — a screen that wraps
 * it in more than a button checks the same hook.
 */
export function AskAssistantButton({
  request,
  children,
  className,
}: {
  request: () => AssistantRequest;
  children: ReactNode;
  className?: string;
}) {
  const available = useAssistantAvailability();
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  if (!available) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => openAssistant(request())}
      className={cn(
        "cursor-pointer gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {children}
    </Button>
  );
}

/** Names the screen already has in its caches (the filter controls load
 *  them), for the chip before the server names the subject itself. */
function cachedNames(queryClient: QueryClient, root: string, ids: string[] | undefined): string[] | undefined {
  if (!ids?.length) return undefined;
  const byId = new Map<string, string>();
  for (const [, data] of queryClient.getQueriesData({ queryKey: [root] })) {
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (row && typeof row === "object" && typeof row.id === "string" && typeof row.name === "string") byId.set(row.id, row.name);
    }
  }
  const names = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return names.length ? names : undefined;
}

/**
 * The search field's door to the assistant (decision 6.1): the words typed go
 * to the assistant as they are, sent at once, with what the screen shows as
 * the subject — the filters on and, on the map, the area in view. undefined
 * when the assistant can't be used (the field then offers nothing).
 */
export function useAskFromSearch(page: "map" | "places"): ((text: string) => void) | undefined {
  const available = useAssistantAvailability();
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  const { filters } = useFilters();
  const queryClient = useQueryClient();
  if (!available) return undefined;

  return (text: string) => {
    const area = page === "map" ? useMapAreaStore.getState().area : null;
    const viewFilters: SubjectViewFilters = {
      ...(filters.city ? { city: filters.city } : {}),
      ...(filters.country ? { country: filters.country } : {}),
      ...(filters.category_ids?.length ? { category_ids: filters.category_ids } : {}),
      ...(filters.subcategory_ids?.length ? { subcategory_ids: filters.subcategory_ids } : {}),
      ...(filters.tag_ids?.length ? { tag_ids: filters.tag_ids } : {}),
      ...(filters.list_id ? { list_id: filters.list_id } : {}),
      ...(filters.rating_min ? { rating_min: filters.rating_min } : {}),
      ...(filters.google_rating_min ? { google_rating_min: filters.google_rating_min } : {}),
      ...(filters.visit_status ? { visit_status: filters.visit_status } : {}),
      ...(filters.open_now ? { open_now: true } : {}),
    };
    const named: ResolvedSubject = {
      kind: "view",
      page,
      filters: {
        city: filters.city,
        country: filters.country,
        categories: cachedNames(queryClient, "categories", filters.category_ids),
        subcategories: cachedNames(queryClient, "subcategories", filters.subcategory_ids),
        tags: cachedNames(queryClient, "tags", filters.tag_ids),
        list: cachedNames(queryClient, "lists", filters.list_id ? [filters.list_id] : undefined)?.[0],
      },
      ...(area ? { area: { lat: area.lat, lng: area.lng, radius_m: Math.round(area.radiusM) } } : {}),
    };
    openAssistant({
      text,
      send: true,
      subject: {
        kind: "view",
        label: subjectLabel(named),
        subject: { kind: "view", page, filters: viewFilters, ...(area ? { area } : {}) },
      },
    });
  };
}
