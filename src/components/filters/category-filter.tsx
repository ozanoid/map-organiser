"use client";

import { useCategories } from "@/lib/hooks/use-categories";
import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  selected?: string;
  onChange: (categoryId: string | undefined) => void;
}

export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const { data: categories = [] } = useCategories();

  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No categories yet</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onChange(undefined)}
        className={cn(
          "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
          !selected
            ? "bg-emerald-100 text-emerald-700"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(selected === cat.id ? undefined : cat.id)}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
            selected === cat.id
              ? "text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
          style={
            selected === cat.id
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
      ))}
    </div>
  );
}
