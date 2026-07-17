"use client";

import { useLists } from "@/lib/hooks/use-lists";
import { useFilters } from "@/lib/hooks/use-filters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ListFilter() {
  const { data: lists = [] } = useLists();
  const { filters, setFilters } = useFilters();

  if (lists.length === 0) {
    return <p className="text-xs text-muted-foreground">No lists yet</p>;
  }

  // Selectable "All lists" reset row (null-clearable pattern, matching
  // country-city-filter) — the native <select> had this and it keeps the
  // filters consistent. `value: null` renders/selects the reset.
  const listItems = [
    { value: null as string | null, label: "All lists" },
    ...lists.map((list) => ({
      value: list.id as string | null,
      label: `${list.name} (${list.place_count || 0})`,
    })),
  ];

  return (
    <Select
      items={listItems}
      value={filters.list_id ?? null}
      onValueChange={(v) =>
        setFilters({ list_id: (v as string | null) ?? undefined })
      }
    >
      <SelectTrigger className="w-full h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {listItems.map((item) => (
          <SelectItem key={item.value ?? "__all"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
