"use client";

import { useState, useEffect, useCallback } from "react";
import { MapView } from "@/components/map/map-view";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { FilterPanel } from "@/components/filters/filter-panel";
import { VisitStatusToggle, VisitStatusBadge } from "@/components/places/visit-status-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlaces } from "@/lib/hooks/use-places";
import { useFilters } from "@/lib/hooks/use-filters";
import { useQueryClient } from "@tanstack/react-query";
import {
  SlidersHorizontal,
  Plus,
  X,
  Star,
  MapPin,
  Clock,
  Globe,
  Phone,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, VisitStatus } from "@/lib/types";

export function MapContent({ mapboxToken }: { mapboxToken: string }) {
  const { filters, hasActiveFilters } = useFilters();
  const { data: places = [], isLoading } = usePlaces(filters);
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [detailData, setDetailData] = useState<Place | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const queryClient = useQueryClient();

  // Close panel helper — shared by X button and popstate
  const closePanel = useCallback(() => {
    setSelectedPlace(null);
  }, []);

  // When a place is selected from popup, fetch full details + push history
  useEffect(() => {
    if (!selectedPlace) {
      setDetailData(null);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/places/${selectedPlace.id}`)
      .then((r) => r.json())
      .then((data) => {
        setDetailData(data);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));

    // Push a history entry so mobile back button closes the panel
    window.history.pushState({ panel: selectedPlace.id }, "");
  }, [selectedPlace]);

  // Listen for browser back to close the detail panel
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      if (selectedPlace) {
        setSelectedPlace(null);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [selectedPlace]);

  function handlePlaceClick(place: Place) {
    setSelectedPlace(place);
  }

  async function handleVisitStatusChange(status: VisitStatus | null) {
    if (!detailData) return;
    const res = await fetch(`/api/places/${detailData.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visit_status: status }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      setDetailData((prev) => prev ? { ...prev, visit_status: status } : prev);
      toast.success(status ? `Marked as ${status.replace(/_/g, " ")}` : "Status cleared");
    }
  }

  async function handleRatingClick(star: number) {
    if (!detailData) return;
    const newRating = detailData.rating === star ? null : star;
    setDetailData((prev) => prev ? { ...prev, rating: newRating } : prev);
    const res = await fetch(`/api/places/${detailData.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: newRating }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["places"] });
    } else {
      setDetailData((prev) => prev ? { ...prev, rating: detailData.rating } : prev);
      toast.error("Failed to update rating");
    }
  }

  const googleData = detailData?.google_data || {};
  const photoUrl = googleData.photo_storage_url || googleData.photos?.[0] || null;
  const reviews = googleData.reviews || [];

  return (
    <div className="flex h-full">
      {/* Desktop filter sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r p-4 overflow-y-auto">
        <FilterPanel />
      </aside>

      <div className="relative flex-1">
        <MapView
          places={places}
          onPlaceClick={handlePlaceClick}
          mapboxToken={mapboxToken}
          className="w-full h-full"
        />

        {/* Floating filter button (mobile) */}
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="shadow-md cursor-pointer lg:hidden"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </Button>
        </div>

        {/* FAB — hidden when detail panel is open */}
        {!selectedPlace && (
          <div className="absolute bottom-20 right-4 z-10 lg:bottom-6">
            <Button
              size="lg"
              className="rounded-full shadow-lg h-14 w-14 cursor-pointer"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-6 w-6" />
            </Button>
          </div>
        )}

        {/* Place count */}
        {!isLoading && places.length > 0 && !selectedPlace && (
          <div className="absolute top-4 right-16 z-10 lg:right-4">
            <div className="bg-white/90 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-md text-sm font-medium text-gray-700">
              {places.length} place{places.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* Slide-in detail panel */}
        {selectedPlace && (
          <div className="absolute top-0 right-0 bottom-0 w-full sm:w-96 z-20 bg-white border-l shadow-xl overflow-y-auto pb-14 lg:pb-0">
            {/* Close button */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 flex items-center justify-between p-3 border-b">
              <h2 className="font-semibold text-sm truncate flex-1">
                {selectedPlace.name}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 cursor-pointer shrink-0"
                onClick={() => { window.history.back(); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {detailLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : detailData ? (
              <div className="p-4 space-y-4">
                {/* Photo */}
                {photoUrl && (
                  <div className="h-40 rounded-lg overflow-hidden bg-gray-100">
                    <img
                      src={photoUrl}
                      alt={detailData.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Address */}
                {detailData.address && (
                  <p className="text-sm text-muted-foreground">
                    {detailData.address}
                  </p>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {detailData.category && (
                    <Badge
                      className="gap-1 text-xs"
                      style={{
                        backgroundColor: detailData.category.color,
                        color: "white",
                      }}
                    >
                      {detailData.category.name}
                    </Badge>
                  )}
                  {detailData.visit_status && (
                    <VisitStatusBadge status={detailData.visit_status} />
                  )}
                  {(detailData.city || detailData.country) && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <MapPin className="h-3 w-3" />
                      {detailData.city && detailData.country
                        ? `${detailData.city}, ${detailData.country}`
                        : detailData.city || detailData.country}
                    </Badge>
                  )}
                </div>

                {/* Visit Status */}
                <VisitStatusToggle
                  value={detailData.visit_status}
                  onChange={handleVisitStatusChange}
                  size="sm"
                />

                {/* Ratings */}
                <div className="space-y-2">
                  {googleData.rating && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Star className="h-4 w-4 fill-orange-400 text-orange-400" />
                      <span className="font-medium">{googleData.rating}</span>
                      {googleData.user_ratings_total && (
                        <span className="text-xs text-muted-foreground">
                          ({googleData.user_ratings_total} reviews)
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">
                      {detailData.rating ? "Your rating:" : "Rate:"}
                    </span>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => handleRatingClick(star)}
                        className="cursor-pointer p-2 -m-1"
                        aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            star <= (detailData.rating || 0)
                              ? "fill-emerald-500 text-emerald-500"
                              : "text-gray-300"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-2 text-sm">
                  {googleData.opening_hours?.weekday_text && (
                    <div className="flex items-start gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {googleData.opening_hours.weekday_text.map((t: string, i: number) => (
                          <p key={i}>{t}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {googleData.website && (
                    <a
                      href={googleData.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-emerald-600 hover:underline cursor-pointer"
                    >
                      <Globe className="h-4 w-4" />
                      <span className="text-xs truncate">{new URL(googleData.website).hostname}</span>
                    </a>
                  )}
                  {googleData.phone && (
                    <a href={`tel:${googleData.phone}`} className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs">{googleData.phone}</span>
                    </a>
                  )}
                </div>

                {/* Reviews */}
                {reviews.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase">Reviews</h3>
                    {reviews.slice(0, 3).map((review: any, i: number) => (
                      <div key={i} className="text-xs space-y-0.5 border-l-2 border-gray-100 pl-2">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{review.author_name}</span>
                          <span className="text-orange-400">
                            {"★".repeat(review.rating)}
                          </span>
                        </div>
                        <p className="text-muted-foreground line-clamp-2">{review.text}</p>
                        <p className="text-muted-foreground/60">{review.relative_time}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {detailData.notes && (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-muted-foreground">
                    {detailData.notes}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {googleData.url && (
                    <a
                      href={googleData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full cursor-pointer gap-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Google Maps
                      </Button>
                    </a>
                  )}
                  <a href={`/places/${detailData.id}`} className="flex-1">
                    <Button size="sm" className="w-full cursor-pointer gap-1.5">
                      Full details
                    </Button>
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <AddPlaceDialog open={addOpen} onOpenChange={setAddOpen} />
        <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} />
      </div>
    </div>
  );
}
