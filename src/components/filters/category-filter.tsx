"use client";

import { useCategories } from "@/lib/hooks/use-categories";
import { useSubcategories } from "@/lib/hooks/use-subcategories";
import { cn } from "@/lib/utils";
import type { Subcategory } from "@/lib/types";

interface CategoryFilterProps {
  selected?: string[];
  onChange: (categoryIds: string[] | undefined) => void;
  /**
   * When provided, the filter renders sub-category pills under each active
   * parent category. Omit these to render the legacy single-row version.
   */
  selectedSubcategories?: string[];
  onSubcategoryChange?: (subcategoryIds: string[] | undefined) => void;
}

export function CategoryFilter({
  selected,
  onChange,
  selectedSubcategories,
  onSubcategoryChange,
}: CategoryFilterProps) {
  const { data: categories = [] } = useCategories();
  const { data: subcategories = [] } = useSubcategories();

  if (categories.length === 0) {
    return <p className="text-xs text-muted-foreground">No categories yet</p>;
  }

  function toggle(catId: string) {
    const isSelected = selected?.includes(catId);
    const next = isSelected
      ? selected!.filter((id) => id !== catId)
      : [...(selected || []), catId];
    onChange(next.length > 0 ? next : undefined);

    // When deselecting a parent, also drop any of its selected subcategories.
    if (isSelected && onSubcategoryChange && selectedSubcategories?.length) {
      const removedSubs = subcategories
        .filter((s) => s.parent_category_id === catId)
        .map((s) => s.id);
      const filtered = selectedSubcategories.filter(
        (id) => !removedSubs.includes(id)
      );
      onSubcategoryChange(filtered.length ? filtered : undefined);
    }
  }

  function toggleSubcategory(subId: string) {
    if (!onSubcategoryChange) return;
    const isSelected = selectedSubcategories?.includes(subId);
    const next = isSelected
      ? selectedSubcategories!.filter((id) => id !== subId)
      : [...(selectedSubcategories || []), subId];
    onSubcategoryChange(next.length > 0 ? next : undefined);
  }

  const showCascade = Boolean(onSubcategoryChange);
  const activeParents = new Set(selected ?? []);

  return (
    <div className="space-y-2">
      {/* Parent category row */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => {
            onChange(undefined);
            // Clearing all parents also clears all subcategories
            if (onSubcategoryChange) onSubcategoryChange(undefined);
          }}
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
          const isActive = activeParents.has(cat.id);
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
              style={isActive ? { backgroundColor: cat.color } : undefined}
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

      {/* Cascade: subcategory pills under each active parent */}
      {showCascade && activeParents.size > 0 && (
        <SubcategoryCascade
          subcategories={subcategories}
          categories={categories}
          activeParents={activeParents}
          selectedSubcategories={selectedSubcategories}
          onToggle={toggleSubcategory}
        />
      )}
    </div>
  );
}

interface SubcategoryCascadeProps {
  subcategories: Subcategory[];
  categories: { id: string; name: string; color: string }[];
  activeParents: Set<string>;
  selectedSubcategories?: string[];
  onToggle: (id: string) => void;
}

function SubcategoryCascade({
  subcategories,
  categories,
  activeParents,
  selectedSubcategories,
  onToggle,
}: SubcategoryCascadeProps) {
  const grouped = new Map<string, Subcategory[]>();
  for (const sub of subcategories) {
    if (!activeParents.has(sub.parent_category_id)) continue;
    if (!grouped.has(sub.parent_category_id)) {
      grouped.set(sub.parent_category_id, []);
    }
    grouped.get(sub.parent_category_id)!.push(sub);
  }

  if (grouped.size === 0) return null;

  return (
    <div className="pl-2 border-l-2 border-emerald-200 dark:border-emerald-900 space-y-1.5">
      {[...grouped.entries()].map(([parentId, subs]) => {
        const parent = categories.find((c) => c.id === parentId);
        if (!parent || subs.length === 0) return null;
        return (
          <div key={parentId}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              {parent.name}
            </p>
            <div className="flex flex-wrap gap-1">
              {subs.map((sub) => {
                const isActive = selectedSubcategories?.includes(sub.id);
                return (
                  <button
                    key={sub.id}
                    onClick={() => onToggle(sub.id)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer",
                      isActive
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700"
                    )}
                  >
                    {sub.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
