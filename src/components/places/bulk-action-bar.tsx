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
    resetSelect?: (el: HTMLSelectElement) => void,
    selectEl?: HTMLSelectElement
  ) {
    setLoading(true);
    try {
      const result = await bulkAction({ ...body, place_ids: ids });
      toast.success(`${label} - ${result.affected} place${result.affected === 1 ? "" : "s"} updated`);
      queryClient.invalidateQueries({ queryKey: ["places"] });
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
      if (selectEl) selectEl.value = "";
    }
  }

  async function handleDelete() {
    const confirmed = confirm(
      `Delete ${count} place${count === 1 ? "" : "s"}? This cannot be undone.`
    );
    if (!confirmed) return;
    await runAction("Deleted", { action: "delete" });
    onClear();
  }

  return (
    <div className="fixed bottom-14 lg:bottom-0 left-0 right-0 z-30 bg-white border-t shadow-lg">
      <div className="h-12 flex items-center gap-2 px-4 max-w-screen-2xl mx-auto">
        {/* Left: count + clear */}
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

        <div className="h-4 w-px bg-border mx-1" />

        {/* Action selects */}
        <select
          disabled={loading}
          className="h-7 text-xs border rounded px-1.5 bg-white cursor-pointer disabled:opacity-50"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            runAction("Category updated", {
              action: "update_category",
              category_id: val,
            }, undefined, e.target);
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

        <select
          disabled={loading}
          className="h-7 text-xs border rounded px-1.5 bg-white cursor-pointer disabled:opacity-50"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            runAction("Tag added", {
              action: "add_tags",
              tag_ids: [val],
            }, undefined, e.target);
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

        <select
          disabled={loading}
          className="h-7 text-xs border rounded px-1.5 bg-white cursor-pointer disabled:opacity-50"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            runAction("Added to list", {
              action: "add_to_list",
              list_id: val,
            }, undefined, e.target);
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

        <select
          disabled={loading}
          className="h-7 text-xs border rounded px-1.5 bg-white cursor-pointer disabled:opacity-50"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            runAction("Status updated", {
              action: "update_status",
              visit_status: val,
            }, undefined, e.target);
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

        {/* Delete */}
        <button
          type="button"
          disabled={loading}
          onClick={handleDelete}
          className="h-7 px-2 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 flex items-center gap-1 cursor-pointer disabled:opacity-50 ml-auto"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}
