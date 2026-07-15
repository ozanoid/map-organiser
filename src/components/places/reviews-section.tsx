"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Star,
  ThumbsUp,
  X,
} from "lucide-react";
import type { GoogleReview } from "@/lib/types";

const REVIEWS_PER_PAGE = 5;

/**
 * Reviews list with client-side pagination + newest-first sort toggle.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor).
 *
 * NF-06 review layer (v1.17.0): owner answers, review photo thumbnails
 * with a lightbox, Local Guide chip, helpful-vote count. All four fields
 * are optional on GoogleReview — they only exist on reviews fetched after
 * the data-layer upgrade, so every render is empty-safe.
 */
export function ReviewsSection({
  reviews,
  hasPlaceId,
  provider,
  refreshing,
  enriching,
  onRefresh,
  topicFilter,
  onClearTopicFilter,
}: {
  reviews: GoogleReview[];
  hasPlaceId: boolean;
  provider?: string;
  refreshing: boolean;
  enriching: boolean;
  onRefresh: () => void;
  /** NF-03 (v1.18.0): active "People mention" topic — case-insensitive
   *  substring match against review text. Page owns the state. */
  topicFilter?: string | null;
  onClearTopicFilter?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [sortByDate, setSortByDate] = useState(false);
  // Render-time state adjustment (React-endorsed pattern): a NEW topic
  // filter starts on page 1 — the clamp alone would land on the LAST
  // page of the shrunken list, and clearing would jump to a stale page.
  const [prevTopicFilter, setPrevTopicFilter] = useState(topicFilter);
  if (prevTopicFilter !== topicFilter) {
    setPrevTopicFilter(topicFilter);
    setPage(0);
  }
  // Lightbox for review photos: which review's images + which index.
  // `open` is separate so the content stays mounted through base-ui's
  // exit animation (nulling the data on close would collapse the popup
  // to an empty shell mid-fade).
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // NF-03 topic filter first, then sort. Page reset on filter change is
  // handled by the effect-free pattern: the page passes a fresh filter →
  // computed pages shrink; clamp below keeps the index valid.
  const topicFiltered = topicFilter
    ? reviews.filter((r) =>
        r.text.toLowerCase().includes(topicFilter.toLowerCase())
      )
    : reviews;

  const sorted = sortByDate
    ? [...topicFiltered].sort((a, b) => {
        // publish_time is ISO string or undefined
        const ta = a.publish_time ? new Date(a.publish_time).getTime() : 0;
        const tb = b.publish_time ? new Date(b.publish_time).getTime() : 0;
        return tb - ta; // newest first
      })
    : topicFiltered;

  const totalPages = Math.ceil(sorted.length / REVIEWS_PER_PAGE);
  // Clamp instead of resetting via effect — the topic filter can shrink
  // the page count under the current index.
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageReviews = sorted.slice(
    safePage * REVIEWS_PER_PAGE,
    (safePage + 1) * REVIEWS_PER_PAGE
  );

  // Page reset lives in the toggle handler (not an effect) — same
  // interaction, one render, no set-state-in-effect.
  function toggleSort() {
    setSortByDate((s) => !s);
    setPage(0);
  }

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
          {topicFilter && (
            <button
              type="button"
              onClick={onClearTopicFilter}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full cursor-pointer bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
              aria-label={`Clear "${topicFilter}" filter`}
            >
              “{topicFilter}” ({topicFiltered.length})
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {reviews.length > 1 && (
            <button
              type="button"
              onClick={toggleSort}
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
              disabled={refreshing || enriching}
              className="cursor-pointer gap-1 text-xs text-muted-foreground"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing || enriching ? "animate-spin" : ""}`}
              />
              {enriching ? "Loading..." : "Refresh"}
            </Button>
          )}
        </div>
      </div>

      {/* Review cards */}
      {pageReviews.length > 0 ? (
        <div className="space-y-3">
          {pageReviews.map((review, i) => (
            <div
              key={`${safePage}-${i}`}
              className="border rounded-lg p-3 space-y-1.5 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{review.author_name}</span>
                  {review.local_guide && (
                    <Badge
                      variant="secondary"
                      className="text-[9px] py-0 px-1.5 shrink-0"
                    >
                      Local Guide
                    </Badge>
                  )}
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
              {/* NF-06: review photos → thumbnail strip + lightbox */}
              {review.images && review.images.length > 0 && (
                <div className="flex gap-1.5 pt-1 overflow-x-auto">
                  {review.images.map((url, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => {
                        setLightbox({ images: review.images!, index: j });
                        setLightboxOpen(true);
                      }}
                      className="h-16 w-16 shrink-0 rounded-md overflow-hidden bg-muted cursor-pointer hover:opacity-80 transition-opacity"
                      aria-label={`View photo ${j + 1} of ${review.images!.length}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
              {/* NF-06: helpful votes */}
              {typeof review.votes_count === "number" &&
                review.votes_count > 0 && (
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground pt-0.5">
                    <ThumbsUp className="h-2.5 w-2.5" />
                    {review.votes_count}{" "}
                    {review.votes_count === 1 ? "person" : "people"} found this
                    helpful
                  </p>
                )}
              {/* NF-06: owner's response — indented, muted */}
              {review.owner_answer && (
                <div className="ml-3 mt-1.5 rounded-md bg-muted/60 p-2.5 space-y-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    Response from the owner
                    {review.owner_time_ago && (
                      <span className="font-normal">
                        · {review.owner_time_ago}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {review.owner_answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : enriching ? (
        <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading reviews...
        </div>
      ) : topicFilter ? (
        <p className="text-xs text-muted-foreground">
          No reviews mention “{topicFilter}”.{" "}
          <button
            type="button"
            onClick={onClearTopicFilter}
            className="underline cursor-pointer hover:text-foreground"
          >
            Clear filter
          </button>
        </p>
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
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            disabled={safePage >= totalPages - 1}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* NF-06: review photo lightbox. DialogContent forced dark
          (bg-black text-white) so the built-in close X stays visible over
          the photo in BOTH themes; chevrons get explicit text-gray-900 on
          their white pills for the same reason. */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="p-0 overflow-hidden sm:max-w-2xl bg-black text-white border-none">
          <DialogTitle className="sr-only">Review photo</DialogTitle>
          {lightbox && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.images[lightbox.index]}
                alt={`Review photo ${lightbox.index + 1} of ${lightbox.images.length}`}
                className="w-full max-h-[70vh] object-contain"
              />
              {lightbox.images.length > 1 && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-2 bg-gradient-to-t from-black/60 to-transparent">
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((lb) =>
                        lb
                          ? {
                              ...lb,
                              index:
                                (lb.index - 1 + lb.images.length) %
                                lb.images.length,
                            }
                          : lb
                      )
                    }
                    className="rounded-full bg-white/90 p-1.5 text-gray-900 cursor-pointer hover:bg-white transition-colors"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] text-white/90 tabular-nums">
                    {lightbox.index + 1} / {lightbox.images.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((lb) =>
                        lb
                          ? { ...lb, index: (lb.index + 1) % lb.images.length }
                          : lb
                      )
                    }
                    className="rounded-full bg-white/90 p-1.5 text-gray-900 cursor-pointer hover:bg-white transition-colors"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
