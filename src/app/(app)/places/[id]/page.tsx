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
  Wifi,
  Accessibility,
  Sun,
  ShieldCheck,
  CalendarCheck,
  UtensilsCrossed,
  MessageSquare,
  ThumbsUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, VisitStatus, GoogleReview } from "@/lib/types";

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
  const photoUrl = googleData.photo_storage_url || googleData.photos?.[0] || null;
  const reviews = googleData.reviews || [];
  const hasExtendedData = googleData.provider === "dataforseo";

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
      {photoUrl && (
        <div className="h-52 sm:h-64 rounded-xl overflow-hidden bg-muted">
          <img
            src={photoUrl}
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
                className="cursor-pointer p-2 -m-0.5 bg-transparent border-none hover:scale-110 transition-transform"
                aria-label={`Rate ${i + 1} star${i > 0 ? "s" : ""}`}
              >
                <Star
                  className={`h-4 w-4 ${
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

      {/* DataForSEO Extended Data */}
      {hasExtendedData && (
        <>
          {/* Business Description */}
          {googleData.business_description && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">About</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {googleData.business_description}
              </p>
            </section>
          )}

          {/* Current Status */}
          {googleData.current_status && (
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  googleData.current_status === "opened"
                    ? "bg-green-500"
                    : googleData.current_status === "temporarily_closed"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              <span className="text-xs font-medium">
                {googleData.current_status === "opened"
                  ? "Open now"
                  : googleData.current_status === "temporarily_closed"
                    ? "Temporarily closed"
                    : googleData.current_status === "closed_forever"
                      ? "Permanently closed"
                      : "Closed"}
              </span>
              {googleData.is_claimed && (
                <Badge variant="outline" className="gap-1 text-[10px] py-0">
                  <ShieldCheck className="h-3 w-3 text-blue-500" />
                  Verified
                </Badge>
              )}
            </div>
          )}

          {/* Rating Distribution */}
          {googleData.rating_distribution && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Rating Breakdown</h2>
              <div className="space-y-1">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count =
                    googleData.rating_distribution?.[String(star)] ?? 0;
                  const total = Object.values(
                    googleData.rating_distribution!
                  ).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div
                      key={star}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-3 text-right text-muted-foreground">
                        {star}
                      </span>
                      <Star className="h-3 w-3 text-orange-400 fill-orange-400" />
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Popular Times */}
          {googleData.popular_times && (
            <PopularTimesWidget popularTimes={googleData.popular_times} />
          )}

          {/* Action Buttons */}
          {(googleData.book_online_url || googleData.local_business_links?.length) && (
            <section className="flex flex-wrap gap-2">
              {googleData.book_online_url && (
                <a
                  href={googleData.book_online_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer gap-1.5 text-xs"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" />
                    Book Online
                  </Button>
                </a>
              )}
              {googleData.local_business_links?.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer gap-1.5 text-xs"
                  >
                    {link.type === "menu" ? (
                      <UtensilsCrossed className="h-3.5 w-3.5" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    {link.title || link.type || "Link"}
                  </Button>
                </a>
              ))}
            </section>
          )}

          {/* Business Attributes */}
          {googleData.attributes &&
            Object.keys(googleData.attributes).length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Amenities</h2>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(googleData.attributes).map(
                    ([attr, available]) => (
                      <Badge
                        key={attr}
                        variant="outline"
                        className={`text-[10px] gap-1 ${
                          available
                            ? "text-green-700 border-green-200 bg-green-50"
                            : "text-gray-400 border-gray-200 bg-gray-50 line-through"
                        }`}
                      >
                        {available ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <span className="h-2.5 w-2.5 text-center">-</span>
                        )}
                        {formatAttributeName(attr)}
                      </Badge>
                    )
                  )}
                </div>
              </section>
            )}

          {/* Place Topics */}
          {googleData.place_topics &&
            Object.keys(googleData.place_topics).length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">People mention</h2>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(googleData.place_topics)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 15)
                    .map(([topic, count]) => (
                      <Badge
                        key={topic}
                        variant="secondary"
                        className="text-[10px] gap-1"
                      >
                        {topic}
                        <span className="text-muted-foreground">({count})</span>
                      </Badge>
                    ))}
                </div>
              </section>
            )}
        </>
      )}

      {/* Reviews Section */}
      {(reviews.length > 0 || place.google_place_id) && (
        <ReviewsSection
          reviews={reviews}
          hasPlaceId={!!place.google_place_id}
          provider={googleData.provider}
          refreshing={refreshing}
          onRefresh={handleRefreshGoogle}
        />
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

// ──────────────────────────────────────────────────────────
// Reviews with pagination + date sorting
// ──────────────────────────────────────────────────────────

const REVIEWS_PER_PAGE = 5;

function ReviewsSection({
  reviews,
  hasPlaceId,
  provider,
  refreshing,
  onRefresh,
}: {
  reviews: GoogleReview[];
  hasPlaceId: boolean;
  provider?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(0);
  const [sortByDate, setSortByDate] = useState(false);

  const sorted = sortByDate
    ? [...reviews].sort((a, b) => {
        // publish_time is ISO string or undefined
        const ta = a.publish_time ? new Date(a.publish_time).getTime() : 0;
        const tb = b.publish_time ? new Date(b.publish_time).getTime() : 0;
        return tb - ta; // newest first
      })
    : reviews;

  const totalPages = Math.ceil(sorted.length / REVIEWS_PER_PAGE);
  const pageReviews = sorted.slice(
    page * REVIEWS_PER_PAGE,
    (page + 1) * REVIEWS_PER_PAGE
  );

  // Reset page when sort changes
  useEffect(() => {
    setPage(0);
  }, [sortByDate]);

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Reviews</h2>
          {reviews.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              ({reviews.length})
            </span>
          )}
          {provider && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-muted-foreground">
              via {provider === "dataforseo" ? "DataForSEO" : "Google"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {reviews.length > 1 && (
            <button
              type="button"
              onClick={() => setSortByDate(!sortByDate)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-full cursor-pointer transition-colors ${
                sortByDate
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              <ArrowUpDown className="h-2.5 w-2.5" />
              {sortByDate ? "Newest first" : "Sort by date"}
            </button>
          )}
          {hasPlaceId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
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
      </div>

      {/* Review cards */}
      {pageReviews.length > 0 ? (
        <div className="space-y-3">
          {pageReviews.map((review, i) => (
            <div
              key={`${page}-${i}`}
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
        <p className="text-xs text-muted-foreground">
          No reviews yet. Tap Refresh to fetch reviews.
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────
// Helper components & utilities for DataForSEO extended data
// ──────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
] as const;

function PopularTimesWidget({
  popularTimes,
}: {
  popularTimes: Record<string, Array<{ hour: number; popular_index: number }>>;
}) {
  const [selectedDay, setSelectedDay] = useState(
    DAYS_OF_WEEK[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].key
  );

  const dayData = popularTimes[selectedDay] || [];
  // Filter to reasonable hours (6am - midnight)
  const hours = dayData.filter((h) => h.hour >= 6 && h.hour <= 23);
  const maxIndex = Math.max(...hours.map((h) => h.popular_index), 1);

  if (hours.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Popular Times</h2>
      {/* Day selector */}
      <div className="flex gap-1">
        {DAYS_OF_WEEK.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setSelectedDay(d.key)}
            className={`px-2 py-1 text-[10px] font-medium rounded-full cursor-pointer transition-colors ${
              selectedDay === d.key
                ? "bg-emerald-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {/* Bar chart */}
      <div className="flex items-end gap-[3px] h-20">
        {hours.map((h) => {
          const heightPct = (h.popular_index / maxIndex) * 100;
          const isNow =
            selectedDay ===
              DAYS_OF_WEEK[
                new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
              ].key && h.hour === new Date().getHours();
          return (
            <div
              key={h.hour}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`${h.hour}:00 — ${h.popular_index}% busy`}
            >
              <div
                className={`w-full rounded-sm transition-all ${
                  isNow ? "bg-emerald-500" : "bg-emerald-200"
                }`}
                style={{
                  height: `${Math.max(heightPct, 4)}%`,
                  minHeight: "2px",
                }}
              />
              {h.hour % 3 === 0 && (
                <span className="text-[8px] text-muted-foreground">
                  {h.hour}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatAttributeName(attr: string): string {
  return attr
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Has /, "")
    .replace(/^Serves /, "");
}
