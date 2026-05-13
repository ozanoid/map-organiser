"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePlace } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useLists } from "@/lib/hooks/use-lists";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InlineCategoryCreator } from "@/components/places/inline-category-creator";
import { InlineListCreator } from "@/components/places/inline-list-creator";
import { InlineTagInput } from "@/components/places/inline-tag-input";
import { VisitStatusToggle } from "@/components/places/visit-status-toggle";
import {
  Star,
  Clock,
  Globe,
  Phone,
  Loader2,
  Check,
  X,
  MapPin,
  Database,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { VisitStatus } from "@/lib/types";
import type { RetrievedPlaceData } from "@/lib/hooks/use-place-search";

interface SearchResultPanelProps {
  place: RetrievedPlaceData;
  onClose: () => void;
}

/**
 * Slide-in panel shown after the user picks a search result.
 * Mirrors the AddPlaceDialog form but lives on the map page (no dialog modal).
 */
export function SearchResultPanel({ place, onClose }: SearchResultPanelProps) {
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<number>(0);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visitStatus, setVisitStatus] = useState<VisitStatus | null>("want_to_go");

  const queryClient = useQueryClient();
  const createPlace = useCreatePlace();
  const { data: categories = [] } = useCategories();
  const { data: lists = [] } = useLists();

  // Auto-resolve category from poi types when categories load
  useEffect(() => {
    if (!place.types?.length || categories.length === 0) return;
    if (categoryId) return;

    const resolved = resolveCategoryId(place.types, categories, place.name);
    if (resolved) {
      setCategoryId(resolved);
    } else {
      const other = categories.find((c) => c.name.toLowerCase() === "other");
      if (other) setCategoryId(other.id);
    }
  }, [place, categories, categoryId]);

  function toggleList(listId: string) {
    setSelectedListIds((prev) =>
      prev.includes(listId)
        ? prev.filter((id) => id !== listId)
        : [...prev, listId]
    );
  }

  async function handleSave() {
    createPlace.mutate(
      {
        name: place.name,
        address: place.address,
        country: place.country,
        city: place.city,
        lat: place.lat,
        lng: place.lng,
        category_id: categoryId || undefined,
        rating: rating || undefined,
        notes: notes || undefined,
        google_place_id: place.placeId || undefined,
        google_data: {
          types: place.types,
          rating: place.rating,
          opening_hours: place.openingHours,
          website: place.website,
          phone: place.phone,
          url: place.googleMapsUrl,
          mapbox_id: place._mapbox_id,
          ...(place._extended || {}),
        } as Record<string, unknown>,
        photoRef: place.photoRef,
        source: "mapbox_search",
        visit_status: visitStatus || undefined,
        tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        list_ids: selectedListIds.length > 0 ? selectedListIds : undefined,
      },
      {
        onSuccess: (savedPlace: { id?: string }) => {
          toast.success(`${place.name} saved!`);
          onClose();

          // Fire-and-forget reviews enrichment if DataForSEO match returned a cid.
          const cid = place._extended?.cid;
          if (savedPlace?.id && cid) {
            fetch(`/api/places/${savedPlace.id}/enrich?step=reviews`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cid }),
            }).catch(() => {});
          }
          queryClient.invalidateQueries({ queryKey: ["places"] });
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const photoUrl = place.photoRef || place.photos?.[0] || null;
  const providerLabel =
    place._provider === "dataforseo" ? "DataForSEO" : "Mapbox";
  const ProviderIcon = place._provider === "dataforseo" ? Database : Zap;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-full sm:w-96 z-30 bg-white dark:bg-gray-950 border-l shadow-xl overflow-y-auto pb-14 lg:pb-0">
      {/* Header */}
      <div className="sticky top-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm z-10 flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-sm truncate flex-1 flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
          {place.name}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 cursor-pointer shrink-0"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Photo */}
        {photoUrl && (
          <div className="h-40 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
            <img
              src={photoUrl}
              alt={place.name}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Address */}
        {place.address && (
          <p className="text-sm text-muted-foreground">{place.address}</p>
        )}

        {/* Quick facts */}
        <div className="flex flex-wrap gap-1.5">
          {place.rating && (
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
              {place.rating}
            </Badge>
          )}
          {place.openingHours?.open_now !== undefined && (
            <Badge
              variant={place.openingHours.open_now ? "default" : "secondary"}
              className="gap-1"
            >
              <Clock className="h-3 w-3" />
              {place.openingHours.open_now ? "Open" : "Closed"}
            </Badge>
          )}
          {place.website && (
            <Badge variant="secondary" className="gap-1">
              <Globe className="h-3 w-3" />
              Website
            </Badge>
          )}
          {place.phone && (
            <Badge variant="secondary" className="gap-1">
              <Phone className="h-3 w-3" />
              {place.phone}
            </Badge>
          )}
          {(place.city || place.country) && (
            <Badge variant="outline" className="gap-1">
              <MapPin className="h-3 w-3" />
              {place.city && place.country
                ? `${place.city}, ${place.country}`
                : place.city || place.country}
            </Badge>
          )}
        </div>

        {/* Provider hint */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <ProviderIcon className="h-3 w-3" />
          <span>
            via {providerLabel}
            {place._fetchTimeMs > 0 && (
              <> &middot; {(place._fetchTimeMs / 1000).toFixed(1)}s</>
            )}
          </span>
        </div>

        {/* Visit Status */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Status</label>
          <VisitStatusToggle
            value={visitStatus}
            onChange={setVisitStatus}
            size="sm"
          />
        </div>

        {/* Category */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Category</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              >
                <option value="">Select a category...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
            <InlineCategoryCreator onCreated={(id) => setCategoryId(id)} />
          </div>
        </div>

        {/* Lists */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Lists</label>
          <div className="space-y-1.5">
            {lists.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {lists.map((list) => {
                  const isSelected = selectedListIds.includes(list.id);
                  return (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => toggleList(list.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-all ${
                        isSelected
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: list.color }}
                      />
                      {list.name}
                      {isSelected && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            )}
            <InlineListCreator
              onCreated={(id) =>
                setSelectedListIds((prev) => [...prev, id])
              }
            />
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Tags</label>
          <InlineTagInput
            selectedTagIds={selectedTagIds}
            onChange={setSelectedTagIds}
          />
        </div>

        {/* Rating */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Your rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(rating === star ? 0 : star)}
                className="cursor-pointer p-0.5 transition-colors"
              >
                <Star
                  className={`h-6 w-6 ${
                    star <= rating
                      ? "fill-orange-400 text-orange-400"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Notes</label>
          <Textarea
            placeholder="Add a note..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm border-t p-3 flex gap-2">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 cursor-pointer"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={createPlace.isPending}
          className="flex-1 cursor-pointer"
        >
          {createPlace.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-1" />
          )}
          Save to my places
        </Button>
      </div>
    </div>
  );
}
