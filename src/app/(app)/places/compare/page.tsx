"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingDistributionBar } from "@/components/places/rating-distribution-bar";
import { PlaceStatusBadges } from "@/components/places/place-status-badges";
import { AiCompareCard } from "@/components/places/ai-compare-card";
import { haversineDistance } from "@/lib/geo";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import type { Place } from "@/lib/types";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";

/**
 * S2 F-04 (v1.19.0) — /places/compare?ids=a,b,c[,d]
 *
 * Side-by-side comparison of 2-4 places: rating + distribution, price,
 * open-now, distance (from the FIRST selected place), theme_insights
 * rows aligned across columns, pros/cons — plus the deliberate-click
 * AI analysis card (AiCompareCard). Entry: multi-select on /places →
 * BulkActionBar "Compare".
 *
 * Data: ONE round-trip via GET /api/places?ids=… (the list route — it
 * has the EWKB-safe location parser and the subcategory join). Column
 * order = ids param order (matches the AI route's idx order).
 */

const THEME_LABEL: Record<string, string> = {
  food: "Food",
  drink: "Drinks",
  service: "Service",
  atmosphere: "Atmosphere",
  value: "Value",
  location: "Location",
  cleanliness: "Cleanliness",
  crowd: "Crowd",
};

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "👍",
  mixed: "🤔",
  negative: "👎",
};

function profileOf(p: Place): PlaceProfile | null {
  const gd = (p.google_data ?? {}) as Record<string, unknown>;
  return (gd.place_profile as PlaceProfile | undefined) ?? null;
}

function ComparePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const ids = [...new Set(idsParam.split(",").filter(Boolean))].slice(0, 4);

  const [places, setPlaces] = useState<Place[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ids.length < 2) {
      setLoading(false);
      return;
    }
    fetch(`/api/places?ids=${ids.join(",")}`)
      .then((res) => res.json())
      .then((data: Place[]) => {
        // Column order = ids param order (the AI idx order too).
        const byId = new Map(data.map((p) => [p.id, p]));
        setPlaces(ids.map((id) => byId.get(id)).filter((p): p is Place => !!p));
      })
      .catch(() => setPlaces([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParam]);

  if (ids.length < 2) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-3">
        <p className="text-sm text-muted-foreground">
          Select 2-4 places on the places list to compare them.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/places")} className="cursor-pointer">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to places
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3">
          {ids.map((id) => (
            <Skeleton key={id} className="h-96 flex-1 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!places || places.length < 2) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-3">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load those places (need at least 2 you own).
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/places")} className="cursor-pointer">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to places
        </Button>
      </div>
    );
  }

  // Union of themes that have signal in ANY column, ordered by max salience.
  const themeSalience = new Map<string, number>();
  for (const p of places) {
    for (const t of profileOf(p)?.theme_insights ?? []) {
      themeSalience.set(
        t.theme,
        Math.max(themeSalience.get(t.theme) ?? 0, t.salience)
      );
    }
  }
  const themes = [...themeSalience.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const anchor = places[0];

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="cursor-pointer gap-1 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-lg font-semibold">
          Compare ({places.length})
        </h1>
      </div>

      {/* AI analysis — deliberate click, one budget unit per run */}
      <AiCompareCard places={places} />

      {/* Columns — min 220px each; on phones 3-4 columns would squeeze
          to ~80px, so the container scrolls horizontally instead. */}
      <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${places.length}, minmax(220px, 1fr))` }}>
        {places.map((place, i) => {
          const gd = (place.google_data ?? {}) as Record<string, unknown>;
          const profile = profileOf(place);
          const photo =
            (gd.photo_storage_url as string | undefined) ?? null;
          const rating = gd.rating as number | undefined;
          const ratingCount = gd.user_ratings_total as number | undefined;
          const dist =
            i > 0 &&
            place.location?.lat != null &&
            anchor.location?.lat != null
              ? haversineDistance(
                  anchor.location.lat,
                  anchor.location.lng,
                  place.location.lat,
                  place.location.lng
                )
              : null;
          return (
            <div key={place.id} className="border rounded-xl p-3 space-y-3 min-w-0">
              {photo && (
                <div className="h-24 rounded-lg overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt={place.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="space-y-1">
                <Link
                  href={`/places/${place.id}`}
                  className="text-sm font-semibold leading-snug hover:underline line-clamp-2"
                >
                  {place.name}
                </Link>
                <div className="flex flex-wrap gap-1">
                  {place.category && (
                    <Badge
                      className="text-[9px] py-0"
                      style={{ backgroundColor: place.category.color, color: "white" }}
                    >
                      {place.category.name}
                    </Badge>
                  )}
                  {place.city && (
                    <Badge variant="outline" className="text-[9px] py-0 gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />
                      {place.city}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Rating + distribution */}
              {rating != null && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Star className="h-4 w-4 fill-orange-400 text-orange-400" />
                  <span className="font-medium">{rating}</span>
                  {ratingCount != null && (
                    <span className="text-muted-foreground text-xs">
                      ({ratingCount})
                    </span>
                  )}
                </div>
              )}
              {gd.rating_distribution != null && (
                <RatingDistributionBar
                  distribution={gd.rating_distribution as Record<string, number>}
                />
              )}

              {/* Price · distance · open-now */}
              <div className="space-y-1.5 text-xs">
                {profile?.features?.price_range && (
                  <p>
                    <span className="text-muted-foreground">Price: </span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {profile.features.price_range}
                    </span>
                  </p>
                )}
                {dist != null && (
                  <p className="text-muted-foreground">
                    {dist < 1
                      ? `${Math.round(dist * 1000)} m`
                      : `${dist.toFixed(1)} km`}{" "}
                    from {anchor.name}
                  </p>
                )}
                <PlaceStatusBadges
                  currentStatus={gd.current_status as string | undefined}
                  isClaimed={gd.is_claimed as boolean | undefined}
                  timetable={gd.work_timetable as never}
                  tz={gd.tz as string | undefined}
                />
              </div>

              {/* Theme rows — aligned across columns */}
              {themes.length > 0 && (
                <div className="space-y-1 border-t pt-2">
                  {themes.map((theme) => {
                    const insight = profileOf(place)?.theme_insights?.find(
                      (t) => t.theme === theme
                    );
                    return (
                      <div key={theme} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {THEME_LABEL[theme] ?? theme}
                        </span>
                        {insight ? (
                          <span>
                            {SENTIMENT_EMOJI[insight.sentiment] ?? ""}{" "}
                            <span className="text-muted-foreground">
                              ({insight.mention_count}x)
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pros / cons */}
              {profile?.pros && profile.pros.length > 0 && (
                <div className="border-t pt-2 space-y-0.5">
                  {profile.pros.slice(0, 4).map((pro, j) => (
                    <p key={j} className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-snug">
                      ✓ {pro}
                    </p>
                  ))}
                  {profile.cons?.slice(0, 3).map((con, j) => (
                    <p key={j} className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                      ⚠ {con}
                    </p>
                  ))}
                </div>
              )}
              {!profile && (
                <p className="text-[11px] text-muted-foreground border-t pt-2">
                  No AI profile yet — refresh the place to generate one.
                </p>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <ComparePageInner />
    </Suspense>
  );
}
