"use client";

import { useCategories } from "@/lib/hooks/use-categories";
import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  selected?: string[];
  onChange: (categoryIds: string[] | undefined) => void;
}

export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const { data: categories = [] } = useCategories();

  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No categories yet</p>
    );
  }

  function toggle(catId: string) {
    const isSelected = selected?.includes(catId);
    const next = isSelected
      ? selected!.filter((id) => id !== catId)
      : [...(selected || []), catId];
    onChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onChange(undefined)}
        className={cn(
          "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
          !selected || selected.length === 0
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        )}
      >
        All
      </button>
      {categories.map((cat) => {
        const isActive = selected?.includes(cat.id);
        return (
          <button
            key={cat.id}
            onClick={() => toggle(cat.id)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
              isActive
                ? "text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            )}
            style={
              isActive
                ? { backgroundColor: cat.color }
                : undefined
            }
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: cat.color }}
            />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
