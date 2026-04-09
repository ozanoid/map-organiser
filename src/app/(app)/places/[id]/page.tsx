"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Globe,
  Phone,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import type { Place } from "@/lib/types";

export default function PlaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [place, setPlace] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/places/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setPlace(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this place?")) return;

    const res = await fetch(`/api/places/${params.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Place deleted");
      router.push("/places");
    } else {
      toast.error("Failed to delete place");
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (!place) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Place not found.</p>
      </div>
    );
  }

  const googleData = place.google_data || {};
  const photos = googleData.photos || [];

  return (
    <div className="p-4 lg:p-6 max-w-2xl space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="cursor-pointer gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Photo */}
      {photos.length > 0 && (
        <div className="h-48 sm:h-64 rounded-lg overflow-hidden bg-gray-100">
          <img
            src={photos[0]}
            alt={place.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Title + info */}
      <div>
        <h1 className="text-2xl font-semibold">{place.name}</h1>
        {place.address && (
          <p className="text-sm text-muted-foreground mt-1 flex items-start gap-1.5">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
            {place.address}
          </p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        {place.category && (
          <Badge className="gap-1" style={{ backgroundColor: place.category.color, color: "white" }}>
            {place.category.name}
          </Badge>
        )}
        {place.rating && (
          <Badge variant="secondary" className="gap-1">
            {Array.from({ length: place.rating }).map((_, i) => (
              <Star key={i} className="h-3 w-3 fill-orange-400 text-orange-400" />
            ))}
          </Badge>
        )}
        {place.country && (
          <Badge variant="outline">
            {place.city ? `${place.city}, ${place.country}` : place.country}
          </Badge>
        )}
      </div>

      {/* Google data */}
      <div className="space-y-3">
        {googleData.rating && (
          <div className="flex items-center gap-2 text-sm">
            <Star className="h-4 w-4 fill-orange-400 text-orange-400" />
            <span>
              {googleData.rating} ({googleData.user_ratings_total} reviews)
            </span>
          </div>
        )}
        {googleData.opening_hours?.weekday_text && (
          <div className="text-sm">
            <div className="flex items-center gap-2 mb-1 font-medium">
              <Clock className="h-4 w-4" />
              Opening hours
            </div>
            <div className="ml-6 space-y-0.5 text-muted-foreground text-xs">
              {googleData.opening_hours.weekday_text.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        )}
        {googleData.website && (
          <a
            href={googleData.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
          >
            <Globe className="h-4 w-4" />
            Website
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {googleData.phone && (
          <a
            href={`tel:${googleData.phone}`}
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
          >
            <Phone className="h-4 w-4" />
            {googleData.phone}
          </a>
        )}
        {googleData.url && (
          <a
            href={googleData.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
          >
            <MapPin className="h-4 w-4" />
            View on Google Maps
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Notes */}
      {place.notes && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-1">Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {place.notes}
          </p>
        </div>
      )}
    </div>
  );
}
