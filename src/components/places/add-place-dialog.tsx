"use client";

import { useState } from "react";
import { useParseLink, useCreatePlace } from "@/lib/hooks/use-places";
import { useCategories, useCreateCategory } from "@/lib/hooks/use-categories";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { ParsedPlaceData } from "@/lib/types";

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

  const parseLink = useParseLink();
  const createPlace = useCreatePlace();
  const { data: categories } = useCategories();

  function reset() {
    setUrl("");
    setPlaceData(null);
    setCategoryId("");
    setNotes("");
    setRating(0);
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
          photos: placeData.photos,
          rating: placeData.rating,
          opening_hours: placeData.openingHours,
          website: placeData.website,
          phone: placeData.phone,
        },
        source: "link",
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

            {/* Category */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Category
              </label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((cat) => (
                    <SelectItem
                      key={cat.id}
                      value={cat.id}
                      className="cursor-pointer"
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
