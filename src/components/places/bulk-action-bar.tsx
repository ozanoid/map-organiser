"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCategories } from "@/lib/hooks/use-categories";
import { useTags } from "@/lib/hooks/use-tags";
import { useLists } from "@/lib/hooks/use-lists";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onComplete: () => void;
}

async function bulkAction(body: Record<string, unknown>) {
  const res = await fetch("/api/places/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Bulk action failed");
  }
  return res.json();
}

const STATUS_OPTIONS = [
  { value: "want_to_go", label: "Want to Go" },
  { value: "booked", label: "Booked" },
  { value: "visited", label: "Visited" },
  { value: "favorite", label: "Favorite" },
] as const;

export function BulkActionBar({
  selectedIds,
  onClear,
  onComplete,
}: BulkActionBarProps) {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { data: lists = [] } = useLists();
  const [loading, setLoading] = useState(false);

  const ids = Array.from(selectedIds);
  const count = ids.length;

  async function runAction(
    label: string,
    body: Record<string, unknown>,
    selectEl?: HTMLSelectElement
  ) {
    setLoading(true);
    try {
      const result = await bulkAction({ ...body, place_ids: ids });
      toast.success(`${label} - ${result.affected} place${result.affected === 1 ? "" : "s"} updated`);
      queryClient.invalidateQueries({ queryKey: ["places"] });
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
      if (selectEl) selectEl.value = "";
    }
  }

  async function handleDelete() {
    // Check trip references first
    let tripWarning = "";
    try {
      const checkRes = await bulkAction({ action: "check_trips", place_ids: ids });
      if (checkRes.tripNames?.length > 0) {
        tripWarning = `\n\n${checkRes.placesInTrips} of these place${checkRes.placesInTrips === 1 ? " is" : "s are"} in trip${checkRes.tripNames.length === 1 ? "" : "s"}: ${checkRes.tripNames.join(", ")}. They will be removed from those trips too.`;
      }
    } catch {}

    const confirmed = confirm(
      `Delete ${count} place${count === 1 ? "" : "s"}? This cannot be undone.${tripWarning}`
    );
    if (!confirmed) return;
    await runAction("Deleted", { action: "delete" });
    onClear();
  }

  return (
    <div className="fixed bottom-14 lg:bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-950 border-t shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-3 py-2 lg:py-0 lg:h-12 lg:flex lg:items-center lg:gap-2">
        {/* Row 1: count + clear + delete */}
        <div className="flex items-center gap-2 mb-2 lg:mb-0">
          <span className="text-sm font-medium whitespace-nowrap">
            {count} selected
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer"
          >
            <X className="h-3 w-3" />
            Clear
          </button>

          <div className="h-4 w-px bg-border mx-1 hidden lg:block" />

          {/* Delete — always visible, pushed right on mobile */}
          <button
            type="button"
            disabled={loading}
            onClick={handleDelete}
            className="h-9 px-3 text-xs border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ml-auto lg:ml-0 lg:order-last"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>

        {/* Row 2: action selects — scrollable on mobile, inline on desktop */}
        <div className="flex gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
          <div className="relative shrink-0">
            <select
              disabled={loading}
              className="h-9 text-sm border rounded-md px-3 pr-7 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50 appearance-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                runAction("Category updated", {
                  action: "update_category",
                  category_id: val,
                }, e.target);
              }}
            >
              <option value="" disabled>
                Category
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
          </div>

          <div className="relative shrink-0">
            <select
              disabled={loading}
              className="h-9 text-sm border rounded-md px-3 pr-7 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50 appearance-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                runAction("Tag added", {
                  action: "add_tags",
                  tag_ids: [val],
                }, e.target);
              }}
            >
              <option value="" disabled>
                Tag
              </option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
          </div>

          <div className="relative shrink-0">
            <select
              disabled={loading}
              className="h-9 text-sm border rounded-md px-3 pr-7 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50 appearance-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                runAction("Added to list", {
                  action: "add_to_list",
                  list_id: val,
                }, e.target);
              }}
            >
              <option value="" disabled>
                List
              </option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
          </div>

          <div className="relative shrink-0">
            <select
              disabled={loading}
              className="h-9 text-sm border rounded-md px-3 pr-7 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50 appearance-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                runAction("Status updated", {
                  action: "update_status",
                  visit_status: val,
                }, e.target);
              }}
            >
              <option value="" disabled>
                Status
              </option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
