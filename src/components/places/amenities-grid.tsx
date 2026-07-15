"use client";

import { Badge } from "@/components/ui/badge";
import {
  ATTRIBUTE_GROUPS,
  groupForAttribute,
  iconForAttribute,
  labelForAttribute,
} from "@/lib/places/attribute-icons";

/**
 * NF-04 (grid leg) — DataForSEO boolean attribute wall, grouped + iconized
 * (v1.18.0; the v1.17.0 extraction was a flat chip wall). Groups are
 * reconstructed from key prefixes (see lib/places/attribute-icons.ts —
 * DataForSEO's own groups are flattened away at storage). Unavailable
 * attributes keep the gray strikethrough treatment.
 */
export function AmenitiesGrid({
  attributes,
}: {
  attributes: Record<string, boolean>;
}) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;

  const byGroup = new Map<string, Array<[string, boolean]>>();
  for (const [attr, available] of entries) {
    const g = groupForAttribute(attr).key;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push([attr, available]);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Amenities</h2>
      {ATTRIBUTE_GROUPS.filter((g) => byGroup.has(g.key)).map((group) => {
        const items = byGroup.get(group.key)!;
        const GroupIcon = group.icon;
        return (
          <div key={group.key} className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <GroupIcon className="h-3 w-3" />
              {group.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {items.map(([attr, available]) => {
                const Icon = iconForAttribute(attr);
                return (
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
                      <Icon className="h-2.5 w-2.5" />
                    ) : (
                      <span className="h-2.5 w-2.5 text-center">-</span>
                    )}
                    {labelForAttribute(attr)}
                  </Badge>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
