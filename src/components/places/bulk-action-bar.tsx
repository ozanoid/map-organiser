"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCategories } from "@/lib/hooks/use-categories";
import { useTags } from "@/lib/hooks/use-tags";
import { useLists } from "@/lib/hooks/use-lists";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, Trash2, X } from "lucide-react";

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
  const router = useRouter();
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

          {/* Compare (S2 F-04, v1.19.0) — only meaningful for 2-4 places;
              disabled outside that range with a hint in the title. */}
          <button
            type="button"
            disabled={loading || count < 2 || count > 4}
            onClick={() =>
              router.push(`/places/compare?ids=${ids.join(",")}`)
            }
            title={
              count < 2
                ? "Select at least 2 places to compare"
                : count > 4
                  ? "Compare works with at most 4 places"
                  : undefined
            }
            className="h-9 px-3 text-xs border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Scale className="h-3.5 w-3.5" />
            Compare
          </button>

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
            <Select
              items={categories.map((c) => ({ value: c.id, label: c.name }))}
              disabled={loading}
              value=""
              onValueChange={(v) => {
                const val = v as string;
                if (!val) return;
                runAction("Category updated", {
                  action: "update_category",
                  category_id: val,
                });
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative shrink-0">
            <Select
              items={tags.map((t) => ({ value: t.id, label: t.name }))}
              disabled={loading}
              value=""
              onValueChange={(v) => {
                const val = v as string;
                if (!val) return;
                runAction("Tag added", {
                  action: "add_tags",
                  tag_ids: [val],
                });
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative shrink-0">
            <Select
              items={lists.map((l) => ({ value: l.id, label: l.name }))}
              disabled={loading}
              value=""
              onValueChange={(v) => {
                const val = v as string;
                if (!val) return;
                runAction("Added to list", {
                  action: "add_to_list",
                  list_id: val,
                });
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="List" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative shrink-0">
            <Select
              items={STATUS_OPTIONS}
              disabled={loading}
              value=""
              onValueChange={(v) => {
                const val = v as string;
                if (!val) return;
                runAction("Status updated", {
                  action: "update_status",
                  visit_status: val,
                });
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
