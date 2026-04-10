"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  VisitStatusToggle,
  VisitStatusBadge,
} from "@/components/places/visit-status-toggle";
import { InlineTagInput } from "@/components/places/inline-tag-input";
import { useLists } from "@/lib/hooks/use-lists";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Globe,
  Phone,
  Trash2,
  ExternalLink,
  RefreshCw,
  Plus,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, VisitStatus } from "@/lib/types";

export default function PlaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [place, setPlace] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [listPopoverOpen, setListPopoverOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const { data: allLists = [] } = useLists();

  const fetchPlace = useCallback(() => {
    fetch(`/api/places/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setPlace(data);
        setNotesValue(data.notes || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    fetchPlace();
  }, [fetchPlace]);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this place?")) return;

    const res = await fetch(`/api/places/${params.id}`, { method: "DELETE" });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      toast.success("Place deleted");
      router.push("/places");
    } else {
      toast.error("Failed to delete place");
    }
  }

  async function handleVisitStatusChange(status: VisitStatus | null) {
    const res = await fetch(`/api/places/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visit_status: status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPlace((prev) => (prev ? { ...prev, ...updated, tags: prev.tags, lists: prev.lists } : prev));
      queryClient.invalidateQueries({ queryKey: ["places"] });
      toast.success(status ? `Marked as ${status.replace("_", " ")}` : "Status cleared");
    } else {
      toast.error("Failed to update status");
    }
  }

  async function handleRefreshGoogle() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/places/${params.id}/refresh-google-data`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Google data refreshed");
        fetchPlace();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to refresh");
      }
    } catch {
      toast.error("Failed to refresh Google data");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/places/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesValue || null }),
      });
      if (res.ok) {
        setPlace((prev) => (prev ? { ...prev, notes: notesValue || null } : prev));
        setEditingNotes(false);
        toast.success("Notes saved");
      } else {
        toast.error("Failed to save notes");
      }
    } catch {
      toast.error("Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleRatingClick(star: number) {
    const newRating = place?.rating === star ? null : star;
    // Optimistic update
    setPlace((prev) => (prev ? { ...prev, rating: newRating } : prev));
    try {
      const res = await fetch(`/api/places/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: newRating }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["places"] });
        toast.success(newRating ? `Rated ${newRating} star${newRating > 1 ? "s" : ""}` : "Rating cleared");
      } else {
        // Revert on failure
        setPlace((prev) => (prev ? { ...prev, rating: place?.rating ?? null } : prev));
        toast.error("Failed to update rating");
      }
    } catch {
      setPlace((prev) => (prev ? { ...prev, rating: place?.rating ?? null } : prev));
      toast.error("Failed to update rating");
    }
  }

  async function handleToggleList(listId: string) {
    if (!place) return;
    const currentListIds = (place.lists || []).map((l) => l.id);
    const isInList = currentListIds.includes(listId);
    const newListIds = isInList
      ? currentListIds.filter((id) => id !== listId)
      : [...currentListIds, listId];

    try {
      const res = await fetch(`/api/places/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_ids: newListIds }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["places"] });
        queryClient.invalidateQueries({ queryKey: ["lists"] });
        fetchPlace();
        toast.success(isInList ? "Removed from list" : "Added to list");
      } else {
        toast.error("Failed to update lists");
      }
    } catch {
      toast.error("Failed to update lists");
    }
  }

  async function handleTagsChange(tagIds: string[]) {
    try {
      const res = await fetch(`/api/places/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids: tagIds }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["places"] });
        queryClient.invalidateQueries({ queryKey: ["tags"] });
        fetchPlace();
        toast.success("Tags updated");
      } else {
        toast.error("Failed to update tags");
      }
    } catch {
      toast.error("Failed to update tags");
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!place) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Place not found.</p>
      </div>
    );
  }

  const googleData = place.google_data || {};
  const photos = googleData.photos || [];
  const reviews = googleData.reviews || [];

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-6 pb-12">
      {/* Header: Back + Name + Delete */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="cursor-pointer gap-1 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-lg font-semibold truncate flex-1 text-center">
          {place.name}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Visit Status Toggle */}
      <VisitStatusToggle
        value={place.visit_status}
        onChange={handleVisitStatusChange}
        size="sm"
      />

      {/* Photo */}
      {photos.length > 0 && (
        <div className="h-52 sm:h-64 rounded-xl overflow-hidden bg-muted">
          <img
            src={photos[0]}
            alt={place.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Info Badges */}
      <div className="flex flex-wrap gap-2">
        {place.category && (
          <Badge
            className="gap-1"
            style={{ backgroundColor: place.category.color, color: "white" }}
          >
            {place.category.name}
          </Badge>
        )}
        {place.visit_status && (
          <VisitStatusBadge status={place.visit_status} />
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

      {/* Address + Google Maps */}
      {place.address && (
        <p className="text-sm text-muted-foreground">{place.address}</p>
      )}
      {googleData.url && (
        <a
          href={googleData.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:underline cursor-pointer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View on Google Maps
        </a>
      )}

      {/* Details Section */}
      <section className="space-y-3">
        {/* Google rating + personal rating */}
        <div className="flex flex-wrap items-center gap-4">
          {googleData.rating && (
            <div className="flex items-center gap-1.5 text-sm">
              <Star className="h-4 w-4 fill-orange-400 text-orange-400" />
              <span className="font-medium">{googleData.rating}</span>
              {googleData.user_ratings_total && (
                <span className="text-muted-foreground text-xs">
                  ({googleData.user_ratings_total} reviews)
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1 text-sm">
            <span className="text-xs text-muted-foreground mr-0.5">
              {place.rating ? "Your rating:" : "Add rating:"}
            </span>
            {Array.from({ length: 5 }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleRatingClick(i + 1)}
                className="cursor-pointer p-0 bg-transparent border-none hover:scale-110 transition-transform"
              >
                <Star
                  className={`h-3.5 w-3.5 ${
                    place.rating && i < place.rating
                      ? "fill-emerald-500 text-emerald-500"
                      : "text-gray-300 hover:text-emerald-300"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Opening hours */}
        {googleData.opening_hours?.weekday_text && (
          <div className="text-sm">
            <div className="flex items-center gap-2 mb-1.5 font-medium">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Opening hours
            </div>
            <div className="ml-6 space-y-0.5 text-muted-foreground text-xs">
              {googleData.opening_hours.weekday_text.map(
                (line: string, i: number) => (
                  <p key={i}>{line}</p>
                )
              )}
            </div>
          </div>
        )}

        {/* Website */}
        {googleData.website && (
          <a
            href={googleData.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline cursor-pointer"
          >
            <Globe className="h-4 w-4" />
            Website
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Phone */}
        {googleData.phone && (
          <a
            href={`tel:${googleData.phone}`}
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline cursor-pointer"
          >
            <Phone className="h-4 w-4" />
            {googleData.phone}
          </a>
        )}

        {/* Price level */}
        {googleData.price_level != null && googleData.price_level > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">Price:</span>
            <span className="font-medium text-emerald-700">
              {"$".repeat(googleData.price_level)}
            </span>
            <span className="text-gray-300">
              {"$".repeat(4 - googleData.price_level)}
            </span>
          </div>
        )}

        {/* Editorial summary */}
        {googleData.editorial_summary && (
          <p className="text-sm text-muted-foreground italic border-l-2 border-emerald-200 pl-3">
            {googleData.editorial_summary}
          </p>
        )}

        {/* Google Maps link */}
        {googleData.url && (
          <a
            href={googleData.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-emerald-600 hover:underline cursor-pointer"
          >
            <MapPin className="h-4 w-4" />
            View on Google Maps
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </section>

      {/* Reviews Section */}
      {(reviews.length > 0 || place.google_place_id) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Google Reviews</h2>
            {place.google_place_id && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshGoogle}
                disabled={refreshing}
                className="cursor-pointer gap-1 text-xs text-muted-foreground"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            )}
          </div>
          {reviews.length > 0 ? (
            <div className="space-y-3">
              {reviews.map((review, i) => (
                <div
                  key={i}
                  className="border rounded-lg p-3 space-y-1.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">
                      {review.author_name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {review.relative_time}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star
                        key={j}
                        className={`h-3 w-3 ${
                          j < review.rating
                            ? "fill-orange-400 text-orange-400"
                            : "text-gray-300"
                        }`}
                      />
                    ))}
                  </div>
                  {review.text && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {review.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No reviews yet.</p>
          )}
        </section>
      )}

      {/* Lists Section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Lists</h2>
          <Popover open={listPopoverOpen} onOpenChange={setListPopoverOpen}>
            <PopoverTrigger
              className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground cursor-pointer rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add to list
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              {allLists.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2 text-center">
                  No lists yet. Create one first.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {allLists.map((list) => {
                    const isInList = (place.lists || []).some((l) => l.id === list.id);
                    return (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => handleToggleList(list.id)}
                        className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      >
                        <div
                          className="h-4 w-4 rounded border flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: isInList ? list.color : "transparent",
                            borderColor: list.color,
                          }}
                        >
                          {isInList && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <span className="truncate">{list.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {place.lists && place.lists.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {place.lists.map((list) => (
              <Badge
                key={list.id}
                variant="secondary"
                className="gap-1"
                style={{
                  backgroundColor: list.color + "20",
                  color: list.color,
                  borderColor: list.color + "40",
                }}
              >
                {list.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Not in any lists.</p>
        )}
      </section>

      {/* Tags Section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Tags</h2>
          <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
            <PopoverTrigger
              className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground cursor-pointer rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add tag
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <InlineTagInput
                selectedTagIds={(place.tags || []).map((t) => t.id)}
                onChange={handleTagsChange}
              />
            </PopoverContent>
          </Popover>
        </div>
        {place.tags && place.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {place.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="text-xs"
                style={
                  tag.color
                    ? {
                        backgroundColor: tag.color + "15",
                        color: tag.color,
                        borderColor: tag.color + "40",
                      }
                    : undefined
                }
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tags.</p>
        )}
      </section>

      {/* Notes Section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Notes</h2>
          {!editingNotes && (
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer text-xs text-muted-foreground"
              onClick={() => {
                setNotesValue(place.notes || "");
                setEditingNotes(true);
              }}
            >
              {place.notes ? "Edit" : "Add notes"}
            </Button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Write your notes..."
              className="w-full min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="cursor-pointer text-xs"
              >
                {savingNotes ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingNotes(false)}
                className="cursor-pointer text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : place.notes ? (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {place.notes}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No notes yet.</p>
        )}
      </section>
    </div>
  );
}
