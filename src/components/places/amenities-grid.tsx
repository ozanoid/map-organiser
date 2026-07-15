"use client";

import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

function formatAttributeName(attr: string): string {
  return attr
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Has /, "")
    .replace(/^Serves /, "");
}

/**
 * NF-04 (grid leg) — DataForSEO boolean attribute wall.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor) — behavior
 * unchanged. (Attribute grouping/icons: S1-PR2.)
 */
export function AmenitiesGrid({
  attributes,
}: {
  attributes: Record<string, boolean>;
}) {
  if (Object.keys(attributes).length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Amenities</h2>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(attributes).map(([attr, available]) => (
          <Badge
            key={attr}
            variant="outline"
            className={`text-[10px] gap-1 ${
              available
                ? "text-green-700 border-green-200 bg-green-50"
                : "text-gray-400 border-gray-200 bg-gray-50 line-through"
            }`}
          >
            {available ? (
              <Check className="h-2.5 w-2.5" />
            ) : (
              <span className="h-2.5 w-2.5 text-center">-</span>
            )}
            {formatAttributeName(attr)}
          </Badge>
        ))}
      </div>
    </section>
  );
}
