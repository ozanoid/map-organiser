"use client";

import type { Place } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VisitStatusBadge } from "@/components/places/visit-status-toggle";
import { Star, ExternalLink, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  useAiSearchStore,
  HIDE_BELOW_SCORE,
} from "@/lib/stores/ai-search-store";
import { googleMapsPlaceUrl } from "@/lib/google/maps-url";

/**
 * PlaceCard — the canonical visual representation of a saved place.
 *
 * AI search mode (Phase 6.5):
 *   - When `useAiSearchStore.rankings` contains this place's id:
 *     * If score < HIDE_BELOW_SCORE → the card returns null (hidden,
 *       the user shouldn't see clearly-mismatched results).
 *     * Otherwise → renders normally with `why` line replacing
 *       address (italic emerald).
 *   - When `rankings` is null (normal browsing mode):
 *     * Address line shown, no fading, no hiding.
 *
 * `className` is forwarded to the inner Card so wrapper components
 * (e.g. SelectablePlaceCard) can apply selection rings without
 * duplicating PlaceCard's body.
 */
export function PlaceCard({
  place,
  className,
  onOpenDetail,
}: {
  place: Place;
  className?: string;
  /**
   * When provided (mobile grid / map), tapping the card opens the detail
   * in a bottom-sheet instead of navigating to `/places/[id]`. Absent →
   * the card is a normal Link (desktop, and everywhere else).
   */
  onOpenDetail?: (place: Place) => void;
}) {
  const googlePhoto =
    place.google_data?.photo_storage_url || place.google_data?.photos?.[0];
  const googleRating = place.google_data?.rating;
  // Cross-platform Maps link — the stored google_data.url is a format
  // the mobile Maps app can't resolve (opens blank).
  const mapsUrl = googleMapsPlaceUrl(
    place.name,
    place.google_place_id,
    place.google_data?.url
  );
  const tags = place.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const extraTagCount = tags.length - 2;

  // AI mode: when rankings exist and this place scored below the hide
  // threshold, the LLM has signaled "this should not surface to the
  // user" — honor that.
  const aiRanking = useAiSearchStore((s) => s.rankings?.get(place.id));
  if (aiRanking !== undefined && aiRanking.score < HIDE_BELOW_SCORE) {
    return null;
  }

  const card = (
    <Card
      className={`overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
        className ?? ""
      }`}
    >
        {/* Photo area with visit status badge */}
        {googlePhoto && (
          <div className="relative h-32 bg-gray-100">
            <img
              src={googlePhoto}
              alt={place.name}
              className="w-full h-full object-cover"
            />
            {place.visit_status && (
              <div className="absolute top-2 right-2">
                <VisitStatusBadge status={place.visit_status} />
              </div>
            )}
          </div>
        )}

        {/* If no photo but has visit status, show badge in a slim header */}
        {!googlePhoto && place.visit_status && (
          <div className="flex justify-end px-3 pt-2">
            <VisitStatusBadge status={place.visit_status} />
          </div>
        )}

        <div className="p-3 space-y-1.5">
          <h3 className="font-medium text-sm line-clamp-1">{place.name}</h3>

          {aiRanking ? (
            <p className="text-[11px] italic text-emerald-700 dark:text-emerald-400 line-clamp-2 flex items-start gap-1">
              <Sparkles className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{aiRanking.why}</span>
            </p>
          ) : place.address ? (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {place.address}
            </p>
          ) : null}

          {/* Tags */}
          {visibleTags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {visibleTags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0"
                >
                  {tag.name}
                </Badge>
              ))}
              {extraTagCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  +{extraTagCount}
                </span>
              )}
            </div>
          )}

          {/* Category, ratings, location */}
          <div className="flex items-center gap-2 flex-wrap">
            {place.category && (
              <Badge
                variant="secondary"
                className="text-[10px] gap-1 px-1.5 py-0"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: place.category.color }}
                />
                {place.category.name}
              </Badge>
            )}

            {/* User rating */}
            {place.rating && (
              <span className="flex items-center gap-0.5 text-xs text-orange-500">
                <Star className="h-3 w-3 fill-current" />
                {place.rating}
              </span>
            )}

            {/* Google rating */}
            {googleRating && !place.rating && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <Star className="h-3 w-3 fill-gray-300 text-gray-300" />
                {googleRating}
              </span>
            )}

            {/* Show both ratings when user has rated and google rating exists */}
            {googleRating && place.rating && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                G: {googleRating}
              </span>
            )}

            {place.country && (
              <span className="text-[10px] text-muted-foreground">
                {place.city ? `${place.city}, ${place.country}` : place.country}
              </span>
            )}

            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 hover:underline ml-auto"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Maps
              </a>
            )}
          </div>
        </div>
      </Card>
  );

  // Mobile grid / map: open the detail in a bottom-sheet on the current
  // page. A div-button (not <button>) avoids nesting the inner Maps <a>
  // inside a button element.
  if (onOpenDetail) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(place)}
        onKeyDown={(e) => {
          // Only the card wrapper itself opens the sheet — not keys that
          // bubbled up from the inner Maps <a> (Enter there must follow
          // the link, mirroring its onClick stopPropagation).
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            onOpenDetail(place);
          }
        }}
        className="block w-full text-left cursor-pointer"
      >
        {card}
      </div>
    );
  }

  return (
    <Link href={`/places/${place.id}`} prefetch={false}>
      {card}
    </Link>
  );
}
