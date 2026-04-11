"use client";

import { useTags } from "@/lib/hooks/use-tags";
import { useFilters } from "@/lib/hooks/use-filters";
import { cn } from "@/lib/utils";

export function TagFilter() {
  const { data: tags = [] } = useTags();
  const { filters, setFilters } = useFilters();

  const selectedIds = filters.tag_ids || [];

  function toggle(tagId: string) {
    const isSelected = selectedIds.includes(tagId);
    const next = isSelected
      ? selectedIds.filter((id) => id !== tagId)
      : [...selectedIds, tagId];
    setFilters({ tag_ids: next.length > 0 ? next : undefined });
  }

  if (tags.length === 0) {
    return <p className="text-xs text-muted-foreground">No tags yet</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const isActive = selectedIds.includes(tag.id);

        return (
          <button
            key={tag.id}
            onClick={() => toggle(tag.id)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
              isActive
                ? "text-white bg-emerald-600"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
            style={
              isActive && tag.color
                ? { backgroundColor: tag.color }
                : undefined
            }
          >
            {tag.color && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
            )}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
