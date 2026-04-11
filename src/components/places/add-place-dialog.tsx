"use client";

import { useState, useEffect } from "react";
import { useParseLink, useCreatePlace } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useLists } from "@/lib/hooks/use-lists";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineCategoryCreator } from "@/components/places/inline-category-creator";
import { InlineListCreator } from "@/components/places/inline-list-creator";
import { InlineTagInput } from "@/components/places/inline-tag-input";
import { VisitStatusToggle } from "@/components/places/visit-status-toggle";
import {
  Link2,
  MapPin,
  Star,
  Clock,
  Globe,
  Phone,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ParsedPlaceData, VisitStatus } from "@/lib/types";

interface AddPlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPlaceDialog({ open, onOpenChange }: AddPlaceDialogProps) {
  const [url, setUrl] = useState("");
  const [placeData, setPlaceData] = useState<ParsedPlaceData | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<number>(0);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visitStatus, setVisitStatus] = useState<VisitStatus | null>(
    "want_to_go"
  );

  const parseLink = useParseLink();
  const createPlace = useCreatePlace();
  const { data: categories = [] } = useCategories();
  const { data: lists = [] } = useLists();

  // Auto-resolve category when placeData arrives
  useEffect(() => {
    if (!placeData || !placeData.types || categories.length === 0) return;
    if (categoryId) return; // Don't override manual selection

    const resolved = resolveCategoryId(
      placeData.types,
      categories,
      placeData.name
    );
    if (resolved) {
      setCategoryId(resolved);
    } else {
      // Fallback to "Other" category
      const other = categories.find(
        (c) => c.name.toLowerCase() === "other"
      );
      if (other) setCategoryId(other.id);
    }
  }, [placeData, categories, categoryId]);

  function reset() {
    setUrl("");
    setPlaceData(null);
    setCategoryId("");
    setNotes("");
    setRating(0);
    setSelectedListIds([]);
    setSelectedTagIds([]);
    setVisitStatus("want_to_go");
    parseLink.reset();
    createPlace.reset();
  }

  async function handlePaste() {
    if (!url.trim()) return;

    parseLink.mutate(url, {
      onSuccess: (data) => setPlaceData(data),
      onError: (err) => toast.error(err.message),
    });
  }

  async function handleSave() {
    if (!placeData) return;

    createPlace.mutate(
      {
        name: placeData.name,
        address: placeData.address,
        country: placeData.country,
        city: placeData.city,
        lat: placeData.lat,
        lng: placeData.lng,
        category_id: categoryId || undefined,
        rating: rating || undefined,
        notes: notes || undefined,
        google_place_id: placeData.placeId,
        google_data: {
          types: placeData.types,
          rating: placeData.rating,
          opening_hours: placeData.openingHours,
          website: placeData.website,
          phone: placeData.phone,
          url: placeData.googleMapsUrl,
        },
        photoRef: placeData.photoRef,
        source: "link",
        visit_status: visitStatus || undefined,
        tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        list_ids: selectedListIds.length > 0 ? selectedListIds : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`${placeData.name} saved!`);
          reset();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function toggleList(listId: string) {
    setSelectedListIds((prev) =>
      prev.includes(listId)
        ? prev.filter((id) => id !== listId)
        : [...prev, listId]
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            Add Place
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Paste link */}
        {!placeData && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Paste a Google Maps link..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePaste()}
                disabled={parseLink.isPending}
              />
              <Button
                onClick={handlePaste}
                disabled={!url.trim() || parseLink.isPending}
                className="shrink-0 cursor-pointer"
              >
                {parseLink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
              </Button>
            </div>

            {parseLink.isPending && (
              <div className="space-y-3">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Paste any Google Maps link to auto-fill place details
            </p>
          </div>
        )}

        {/* Step 2: Preview & customize */}
        {placeData && (
          <div className="space-y-4">
            {/* Photo preview */}
            {placeData.photos.length > 0 && (
              <div className="relative h-40 rounded-lg overflow-hidden bg-gray-100">
                <img
                  src={placeData.photos[0]}
                  alt={placeData.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Place info */}
            <div>
              <h3 className="font-semibold text-lg">{placeData.name}</h3>
              <p className="text-sm text-muted-foreground">
                {placeData.address}
              </p>

              <div className="flex flex-wrap gap-2 mt-2">
                {placeData.rating && (
                  <Badge variant="secondary" className="gap-1">
                    <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
                    {placeData.rating}
                  </Badge>
                )}
                {placeData.openingHours?.open_now !== undefined && (
                  <Badge
                    variant={
                      placeData.openingHours.open_now
                        ? "default"
                        : "secondary"
                    }
                    className="gap-1"
                  >
                    <Clock className="h-3 w-3" />
                    {placeData.openingHours.open_now ? "Open" : "Closed"}
                  </Badge>
                )}
                {placeData.website && (
                  <Badge variant="secondary" className="gap-1">
                    <Globe className="h-3 w-3" />
                    Website
                  </Badge>
                )}
                {placeData.phone && (
                  <Badge variant="secondary" className="gap-1">
                    <Phone className="h-3 w-3" />
                    {placeData.phone}
                  </Badge>
                )}
              </div>
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
              <label className="text-sm font-medium mb-1.5 block">
                Category
              </label>
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
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
                </div>
                <InlineCategoryCreator
                  onCreated={(id) => setCategoryId(id)}
                />
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
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 text-gray-600 hover:border-gray-300"
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
              <label className="text-sm font-medium mb-1.5 block">
                Your rating
              </label>
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

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={reset}
                className="flex-1 cursor-pointer"
              >
                <X className="h-4 w-4 mr-1" />
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
                Save Place
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
