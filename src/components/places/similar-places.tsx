"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Star } from "lucide-react";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { usePlaces } from "@/lib/hooks/use-places";

const MAX_SUGGESTIONS = 6;

/** 1234 → "1.2k" — compact vote counts for the suggestion cards. */
function compactCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}

/**
 * NF-05 (v1.18.0) — "Similar places" from DataForSEO people_also_search.
 * Horizontal card strip, max 6.
 *
 * SINGLE-PATH PREVIEW FLOW (final design, user decision 15.07.2026):
 * clicking a card opens AddPlaceDialog pre-filled with the suggestion's
 * CID URL — parse-link natively understands `?cid=` — so the user gets
 * the SAME first-class preview as a manual add (photo, rating, hours,
 * lite AI profile + chips, category/list/tag pickers) and decides there.
 * Save goes through the standard POST /api/places + enrich chain with
 * `source: "similar"` for provenance. The earlier one-click
 * /api/places/add-similar route was removed with it — one add path,
 * one maintenance surface. Cost: one biz-info lookup per opened preview
 * (deliberate click), identical to what the blind one-click add paid.
 *
 * Suggestions whose CID already exists in the library render "Added ✓"
 * and navigate to the place instead.
 */
export function SimilarPlaces({
  items,
}: {
  items: Array<{
    title: string;
    cid?: string;
    rating?: number;
    category?: string;
    votes_count?: number;
  }>;
}) {
  const router = useRouter();
  // Library CID set — the places list is client-cached already (≤ a few
  // hundred rows), so membership is a cheap client-side lookup. The
  // dialog's save invalidates ["places"], which refreshes this set.
  const { data: allPlaces = [] } = usePlaces({});
  const [previewCid, setPreviewCid] = useState<string | null>(null);

  const cidToPlaceId = new Map<string, string>();
  for (const p of allPlaces) {
    const cid = p.google_data?.cid;
    if (cid) cidToPlaceId.set(cid, p.id);
  }

  const suggestions = items.filter((s) => s.title).slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Similar places</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {suggestions.map((s, idx) => {
          const addedId = s.cid ? cidToPlaceId.get(s.cid) : undefined;
          const clickable = addedId != null || s.cid != null;
          return (
            <button
              key={s.cid ?? `${s.title}-${idx}`}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (addedId) router.push(`/places/${addedId}`);
                else if (s.cid) setPreviewCid(s.cid);
              }}
              className={`w-40 shrink-0 border rounded-lg p-2.5 space-y-1.5 text-left transition-colors ${
                clickable
                  ? "cursor-pointer hover:bg-accent/50 hover:border-border"
                  : "cursor-default"
              }`}
              aria-label={
                addedId
                  ? `${s.title} — already added, open it`
                  : `Preview ${s.title} before adding`
              }
            >
              <p className="text-xs font-medium leading-snug line-clamp-2 min-h-8">
                {s.title}
              </p>
              {s.category && (
                <p className="text-[10px] text-muted-foreground truncate">
                  {s.category}
                </p>
              )}
              <div className="flex items-center justify-between gap-1">
                {typeof s.rating === "number" ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
                    {s.rating}
                    {typeof s.votes_count === "number" &&
                      s.votes_count > 0 && (
                        <span className="text-[10px]">
                          ({compactCount(s.votes_count)})
                        </span>
                      )}
                  </span>
                ) : (
                  <span />
                )}
                {addedId ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-700">
                    <Check className="h-3 w-3" />
                    Added
                  </span>
                ) : s.cid ? (
                  <span className="text-[11px] text-muted-foreground">
                    Preview →
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* First-class preview: the standard AddPlaceDialog, pre-filled with
          the suggestion's CID URL (parse-link handles ?cid= natively).
          Dialog resets itself on close, so consecutive previews re-parse. */}
      <AddPlaceDialog
        open={previewCid !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewCid(null);
        }}
        initialUrl={
          previewCid ? `https://maps.google.com/?cid=${previewCid}` : undefined
        }
        source="similar"
      />
    </section>
  );
}
