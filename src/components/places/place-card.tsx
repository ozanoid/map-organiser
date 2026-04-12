"use client";

import type { Place } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VisitStatusBadge } from "@/components/places/visit-status-toggle";
import { Star, ExternalLink } from "lucide-react";
import Link from "next/link";

export function PlaceCard({ place }: { place: Place }) {
  const googlePhoto = place.google_data?.photo_storage_url || place.google_data?.photos?.[0];
  const googleRating = place.google_data?.rating;
  const tags = place.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const extraTagCount = tags.length - 2;

  return (
    <Link href={`/places/${place.id}`} prefetch={false}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
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

          {place.address && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {place.address}
            </p>
          )}

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

            {place.google_data?.url && (
              <a
                href={place.google_data.url}
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
    </Link>
  );
}
