"use client";

import type { Place } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star } from "lucide-react";
import Link from "next/link";

export function PlaceCard({ place }: { place: Place }) {
  const googlePhoto = place.google_data?.photos?.[0];

  return (
    <Link href={`/places/${place.id}`}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
        {googlePhoto && (
          <div className="h-32 bg-gray-100">
            <img
              src={googlePhoto}
              alt={place.name}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="p-3 space-y-1.5">
          <h3 className="font-medium text-sm line-clamp-1">{place.name}</h3>
          {place.address && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {place.address}
            </p>
          )}
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
            {place.rating && (
              <span className="flex items-center gap-0.5 text-xs text-orange-500">
                <Star className="h-3 w-3 fill-current" />
                {place.rating}
              </span>
            )}
            {place.country && (
              <span className="text-[10px] text-muted-foreground">
                {place.city ? `${place.city}, ${place.country}` : place.country}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
