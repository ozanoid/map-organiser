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

  return (
    <Select
      value={filters.list_id ?? ""}
      onValueChange={(value) =>
        setFilters({ list_id: value || undefined })
      }
    >
      <SelectTrigger size="sm" className="w-full cursor-pointer text-xs">
        <SelectValue placeholder="All lists" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">All lists</SelectItem>
        {lists.map((list) => (
          <SelectItem key={list.id} value={list.id}>
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 shrink-0"
              style={{ backgroundColor: list.color }}
            />
            {list.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
