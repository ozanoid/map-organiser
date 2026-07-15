"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { usePlaces } from "@/lib/hooks/use-places";

const MAX_SUGGESTIONS = 6;

/**
 * NF-05 (v1.18.0) — "Similar places" from DataForSEO people_also_search.
 * Horizontal card strip, max 6. One-click inline add: POST
 * /api/places/add-similar (CID → biz-info lookup → insert), then the
 * standard client-side enrich chain (step=reviews → profile) exactly like
 * the AddPlaceDialog flow. Suggestions whose CID (or added id) already
 * exists in the library render as "Added ✓" linking to the place.
 */
export function SimilarPlaces({
  items,
}: {
  items: Array<{ title: string; cid?: string; rating?: number }>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Library CID set — the places list is client-cached already (≤ a few
  // hundred rows), so membership is a cheap client-side lookup.
  const { data: allPlaces = [] } = usePlaces({});
  const [addingCid, setAddingCid] = useState<string | null>(null);
  // cid → placeId for adds completed in THIS session (cache may lag).
  const [addedThisSession, setAddedThisSession] = useState<
    Record<string, string>
  >({});

  const cidToPlaceId = new Map<string, string>();
  for (const p of allPlaces) {
    const cid = p.google_data?.cid;
    if (cid) cidToPlaceId.set(cid, p.id);
  }
  for (const [cid, id] of Object.entries(addedThisSession)) {
    cidToPlaceId.set(cid, id);
  }

  const suggestions = items.filter((s) => s.title).slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) return null;

  async function handleAdd(cid: string, title: string) {
    // Serialize adds — a second click while one is in flight would both
    // double-spend the DataForSEO call and corrupt the shared spinner
    // state (the first finally would clear the second's indicator).
    if (addingCid) return;
    setAddingCid(cid);
    try {
      const res = await fetch("/api/places/add-similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid, title }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 409) {
        setAddedThisSession((m) => ({ ...m, [cid]: data.id }));
        queryClient.invalidateQueries({ queryKey: ["places"] });
        if (res.status === 200) {
          toast.success(`${title} added`);
          // Same background chain as AddPlaceDialog: reviews → (server-
          // side) profile. Detail-page polling picks the results up.
          fetch(`/api/places/${data.id}/enrich?step=reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cid }),
          }).catch(() => {});
        } else {
          toast.info(`${title} is already in your places`);
        }
      } else {
        toast.error(data.error || "Failed to add place");
      }
    } catch {
      toast.error("Failed to add place");
    } finally {
      // Only clear our own indicator (guards a future de-serialization).
      setAddingCid((c) => (c === cid ? null : c));
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Similar places</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {suggestions.map((s, idx) => {
          const addedId = s.cid ? cidToPlaceId.get(s.cid) : undefined;
          const isAdding = s.cid != null && addingCid === s.cid;
          return (
            <div
              key={s.cid ?? `${s.title}-${idx}`}
              className="w-40 shrink-0 border rounded-lg p-2.5 space-y-1.5"
            >
              <p className="text-xs font-medium leading-snug line-clamp-2 min-h-8">
                {s.title}
              </p>
              <div className="flex items-center justify-between gap-1">
                {typeof s.rating === "number" ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
                    {s.rating}
                  </span>
                ) : (
                  <span />
                )}
                {addedId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/places/${addedId}`)}
                    className="cursor-pointer h-6 px-2 text-[11px] gap-1 text-emerald-700"
                  >
                    <Check className="h-3 w-3" />
                    Added
                  </Button>
                ) : s.cid ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isAdding}
                    onClick={() => handleAdd(s.cid!, s.title)}
                    className="cursor-pointer h-6 px-2 text-[11px] gap-1"
                  >
                    {isAdding ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Add
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
