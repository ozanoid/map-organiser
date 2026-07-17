"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePlace } from "@/lib/hooks/use-places";
import { useCategories } from "@/lib/hooks/use-categories";
import { useSubcategories } from "@/lib/hooks/use-subcategories";
import { useLists } from "@/lib/hooks/use-lists";
import { useTags } from "@/lib/hooks/use-tags";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { VisitStatus } from "@/lib/types";
import type { RetrievedPlaceData } from "@/lib/hooks/use-place-search";
import { useIsDesktop } from "@/lib/hooks/use-is-desktop";
import {
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerTitle,
} from "@/components/ui/drawer";

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
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<number>(0);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visitStatus, setVisitStatus] = useState<VisitStatus | null>("want_to_go");

  const queryClient = useQueryClient();
  const createPlace = useCreatePlace();
  const isDesktop = useIsDesktop();
  const { data: categories = [] } = useCategories();
  const { data: subcategories = [] } = useSubcategories();
  const { data: lists = [] } = useLists();
  const { data: tags = [] } = useTags();

  // lite_profile ships with the retrieve response (same shape parse-link
  // returns). Resolve its heuristic suggestions into UI-friendly shapes.
  const liteProfile = place.lite_profile ?? null;
  const aiSuggestions = useMemo(() => {
    if (!liteProfile) return null;
    const suggestedTagObjects = liteProfile.suggested_tags.matched_existing
      .map((id) => tags.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const suggestedListObjects = liteProfile.suggested_lists
      .map((id) => lists.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l));
    return {
      suggestedTags: suggestedTagObjects,
      suggestedLists: suggestedListObjects,
      subCategorySlug: liteProfile.category_signals.sub_category,
      subCategoryConfidence: liteProfile.category_signals.sub_category_confidence,
    };
  }, [liteProfile, tags, lists]);

  const suggestedSubcategory = useMemo(() => {
    if (!aiSuggestions?.subCategorySlug || !categoryId) return null;
    return subcategories.find(
      (s) =>
        s.slug === aiSuggestions.subCategorySlug &&
        s.parent_category_id === categoryId
    );
  }, [aiSuggestions, categoryId, subcategories]);

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

  // Auto-pre-select the AI-suggested sub-category on high confidence
  // (mirrors AddPlaceDialog; tags & lists stay opt-in).
  useEffect(() => {
    if (!suggestedSubcategory || subcategoryId) return;
    if ((aiSuggestions?.subCategoryConfidence ?? 0) >= 0.85) {
      setSubcategoryId(suggestedSubcategory.id);
    }
  }, [suggestedSubcategory, aiSuggestions, subcategoryId]);

  function toggleList(listId: string) {
    setSelectedListIds((prev) =>
      prev.includes(listId)
        ? prev.filter((id) => id !== listId)
        : [...prev, listId]
    );
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
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
        subcategory_id: subcategoryId || undefined,
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

          // Same two-step enrichment as the URL-paste flow:
          //  1. step=info — DB roundtrip that re-asserts google_data + cid and
          //     hands us a fresh cid for reviews. Resolves any race against the
          //     async photo-download UPDATE that POST /api/places does.
          //  2. step=reviews — fire-and-forget; /places/[id] polling picks it up.
          if (savedPlace?.id) {
            fetch(`/api/places/${savedPlace.id}/enrich?step=info`, { method: "POST" })
              .then((res) => res.json())
              .then((data) => {
                queryClient.invalidateQueries({ queryKey: ["places"] });
                const cid = data?.cid ?? place._extended?.cid;
                if (cid) {
                  fetch(`/api/places/${savedPlace.id}/enrich?step=reviews`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cid }),
                  }).catch(() => {});
                }
              })
              .catch(() => {
                // Fallback: at least invalidate if info failed (e.g. mapbox-only path with no google_place_id)
                queryClient.invalidateQueries({ queryKey: ["places"] });
              });
          }
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const photoUrl = place.photoRef || place.photos?.[0] || null;
  const providerLabel =
    place._provider === "dataforseo" ? "DataForSEO" : "Mapbox";
  const ProviderIcon = place._provider === "dataforseo" ? Database : Zap;

  // Shared inner content (header + body + sticky save footer). Rendered
  // in a desktop side-panel OR a mobile draggable bottom sheet (peek →
  // half → full) — see the return below. The sticky header/footer work
  // inside either scroll container.
  const inner = (
    <>
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
            <div className="flex-1">
              <Select
                items={categories.map((cat) => ({ value: cat.id, label: cat.name }))}
                value={categoryId}
                onValueChange={(v) => {
                  // base-ui fires onValueChange on EVERY item press (unlike
                  // native onChange) — guard so re-picking the same category
                  // doesn't wipe a chosen/auto-suggested subcategory.
                  const next = v as string;
                  if (next === categoryId) return;
                  setCategoryId(next);
                  setSubcategoryId(null);
                }}
              >
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <InlineCategoryCreator onCreated={(id) => setCategoryId(id)} />
          </div>

          {/* Sub-category chips (under selected parent) */}
          {categoryId && (() => {
            const parentSubs = subcategories.filter(
              (s) => s.parent_category_id === categoryId
            );
            if (parentSubs.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 mt-2">
                {parentSubs.map((sub) => {
                  const isActive = subcategoryId === sub.id;
                  const isSuggested = suggestedSubcategory?.id === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSubcategoryId(isActive ? null : sub.id)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                        isActive
                          ? "bg-emerald-600 text-white"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      {isSuggested && <Sparkles className="h-2.5 w-2.5" />}
                      {sub.name}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* AI suggestion chips (tags + lists from lite_profile) */}
        {aiSuggestions &&
          (aiSuggestions.suggestedTags.length > 0 ||
            aiSuggestions.suggestedLists.length > 0) && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2">
              <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI Suggestions
              </p>

              {aiSuggestions.suggestedTags.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {aiSuggestions.suggestedTags.map((tag) => {
                      const isSelected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-emerald-600 text-white"
                              : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          }`}
                        >
                          {tag.name}
                          {isSelected && <Check className="h-2.5 w-2.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {aiSuggestions.suggestedLists.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Lists
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {aiSuggestions.suggestedLists.map((list) => {
                      const isSelected = selectedListIds.includes(list.id);
                      return (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => toggleList(list.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-emerald-600 text-white"
                              : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          }`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: list.color }}
                          />
                          {list.name}
                          {isSelected && <Check className="h-2.5 w-2.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

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

      {/* Sticky action bar — safe-area padding so Save clears the iOS
          home indicator inside the bottom sheet. */}
      <div className="sticky bottom-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
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
    </>
  );

  // Desktop: right side-panel (unchanged). Mobile: Google-Maps-style
  // draggable bottom sheet that opens at a peek and expands upward.
  // modal={false} keeps the map interactive behind the peek.
  if (isDesktop) {
    return (
      <div className="absolute top-0 right-0 bottom-0 w-96 z-30 bg-white dark:bg-gray-950 border-l shadow-xl overflow-y-auto flex flex-col">
        {inner}
      </div>
    );
  }

  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      snapPoints={["220px", 0.55, 0.92]}
      modal={false}
    >
      <DrawerContent modal={false} className="bg-white dark:bg-gray-950">
        {/* a11y name for the role=dialog sheet (header is visual only) */}
        <DrawerTitle className="sr-only">{place.name}</DrawerTitle>
        <DrawerBody className="px-0">{inner}</DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
