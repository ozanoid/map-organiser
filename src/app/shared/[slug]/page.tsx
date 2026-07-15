"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapView } from "@/components/map/map-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSaveSharedContent } from "@/lib/hooks/use-shared-links";
import { useMapStyle } from "@/lib/hooks/use-map-style";
import {
  MapPin, Calendar, Compass, Star, Save, Loader2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, TripDay } from "@/lib/types";

const DAY_COLORS = ["#3B82F6", "#F97316", "#8B5CF6", "#22C55E", "#EC4899", "#06B6D4", "#F59E0B"];

interface SharedData {
  type: "list" | "trip" | "place";
  slug: string;
  ownerName: string;
  list?: { id: string; name: string; description: string | null; color: string };
  places?: Place[];
  /** NF-18 (v1.20.0): single-place share payload (reviews/profile stripped server-side). */
  place?: Place;
  trip?: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    day_count: number;
    place_count: number;
    days: TripDay[];
  };
}

export default function SharedPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveContent = useSaveSharedContent();
  const { mapStyleUrl, markerStyle } = useMapStyle();

  // Check if user is logged in (for save button)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    fetch("/api/user/usage", { redirect: "manual" })
      .then((r) => setIsLoggedIn(r.status === 200))
      .catch(() => setIsLoggedIn(false));
  }, []);

  useEffect(() => {
    fetch(`/api/shared/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          setError("This link is no longer available.");
          setLoading(false);
          return;
        }
        setData(await r.json());
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load shared content.");
        setLoading(false);
      });
  }, [slug]);

  function handleSave() {
    saveContent.mutate(slug, {
      onSuccess: (result) => {
        toast.success("Saved to your account!");
        router.push(
          result.type === "list"
            ? `/lists/${result.id}`
            : result.type === "place"
              ? `/places/${result.id}`
              : `/trips/${result.id}`
        );
      },
      onError: (err) => toast.error(err.message),
    });
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-6 text-center">
        <MapPin className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-lg font-medium">{error || "Not found"}</p>
        <Link href="/" className="text-emerald-600 text-sm mt-2 hover:underline">
          Go to Map Organiser
        </Link>
      </div>
    );
  }

  if (data.type === "list") return <SharedListView data={data} isLoggedIn={isLoggedIn} onSave={handleSave} saving={saveContent.isPending} mapStyleUrl={mapStyleUrl} markerStyle={markerStyle} />;
  if (data.type === "trip") return <SharedTripView data={data} isLoggedIn={isLoggedIn} onSave={handleSave} saving={saveContent.isPending} mapStyleUrl={mapStyleUrl} markerStyle={markerStyle} />;
  if (data.type === "place") return <SharedPlaceView data={data} isLoggedIn={isLoggedIn} onSave={handleSave} saving={saveContent.isPending} mapStyleUrl={mapStyleUrl} markerStyle={markerStyle} />;
  return null;
}

function SharedListView({
  data, isLoggedIn, onSave, saving, mapStyleUrl, markerStyle,
}: {
  data: SharedData; isLoggedIn: boolean; onSave: () => void; saving: boolean;
  mapStyleUrl: string; markerStyle: "icons" | "dots";
}) {
  const places = data.places || [];

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <header className="p-4 border-b">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-sm">Map Organiser</span>
          </div>
          {isLoggedIn && (
            <Button size="sm" className="cursor-pointer" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save to my lists
            </Button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full p-4 space-y-4 flex-1">
        {/* Title */}
        <div>
          <h1 className="text-xl font-semibold">{data.list?.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            by {data.ownerName} · {places.length} place{places.length !== 1 ? "s" : ""}
          </p>
          {data.list?.description && (
            <p className="text-sm text-muted-foreground mt-2">{data.list.description}</p>
          )}
        </div>

        {/* Map */}
        {places.length > 0 && (
          <div className="h-64 sm:h-80 rounded-xl overflow-hidden border">
            <MapView
              places={places}
              mapStyle={mapStyleUrl}
              markerStyle={markerStyle}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Place list */}
        <div className="space-y-2">
          {places.map((place, i) => (
            <PlaceRow key={place.id} place={place} index={i} />
          ))}
        </div>
      </div>

      {/* Footer CTA */}
      <SharedFooter isLoggedIn={isLoggedIn} />
    </div>
  );
}

function SharedTripView({
  data, isLoggedIn, onSave, saving, mapStyleUrl, markerStyle,
}: {
  data: SharedData; isLoggedIn: boolean; onSave: () => void; saving: boolean;
  mapStyleUrl: string; markerStyle: "icons" | "dots";
}) {
  const trip = data.trip;
  if (!trip) return null;
  const days = trip.days || [];
  const allPlaces = days.flatMap((d) => (d.places || []).map((dp: any) => dp.place).filter(Boolean));

  const routeLines = days
    .filter((d) => d.route?.geometry?.coordinates)
    .map((d) => ({
      id: `route-${d.day_number}`,
      color: DAY_COLORS[(d.day_number - 1) % DAY_COLORS.length],
      coordinates: d.route!.geometry.coordinates,
    }));

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <header className="p-4 border-b">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-sm">Map Organiser</span>
          </div>
          {isLoggedIn && (
            <Button size="sm" className="cursor-pointer" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save to my trips
            </Button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full p-4 space-y-4 flex-1">
        {/* Title */}
        <div>
          <h1 className="text-xl font-semibold">{trip.name}</h1>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            by {data.ownerName}
            <span className="mx-0.5">·</span>
            <Calendar className="h-3 w-3" /> {trip.day_count}
            <span className="mx-0.5">·</span>
            <MapPin className="h-3 w-3" /> {trip.place_count}
          </p>
        </div>

        {/* Map */}
        {allPlaces.length > 0 && (
          <div className="h-64 sm:h-80 rounded-xl overflow-hidden border">
            <MapView
              places={allPlaces}
              mapStyle={mapStyleUrl}
              markerStyle={markerStyle}
              routeLines={routeLines}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-4">
          {days.map((day, i) => {
            const color = DAY_COLORS[i % DAY_COLORS.length];
            const dayPlaces = (day.places || []) as any[];
            const dateStr = new Date(day.date).toLocaleDateString("en-GB", {
              weekday: "short", day: "numeric", month: "short",
            });

            return (
              <div key={day.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-6 w-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Day {i + 1}</p>
                    <p className="text-[10px] text-muted-foreground">{dateStr}</p>
                  </div>
                  {day.route && (
                    <span className="text-[10px] text-muted-foreground">
                      {day.route.distance_km} km · {day.route.duration_min} min
                    </span>
                  )}
                </div>
                <div className="pl-3 border-l-2 ml-3 space-y-0" style={{ borderColor: color }}>
                  {dayPlaces.map((dp: any, j: number) => (
                    <div key={dp.id}>
                      {dp.place && <PlaceRow place={dp.place} index={j} />}
                      {j < dayPlaces.length - 1 && day.route?.legs?.[j] && (
                        <div className="flex items-center gap-1.5 pl-6 py-0.5">
                          <span className="text-[9px] text-muted-foreground">
                            {day.route.legs[j].distance_km} km · {day.route.legs[j].duration_min} min
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <SharedFooter isLoggedIn={isLoggedIn} />
    </div>
  );
}

function PlaceRow({ place, index }: { place: Place; index: number }) {
  const googleUrl = place.google_data?.url;

  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="text-xs font-medium text-muted-foreground w-5 text-center shrink-0">
        {index + 1}
      </span>
      <span
        className="h-5 w-5 rounded-full shrink-0"
        style={{ backgroundColor: place.category?.color || "#6B7280" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{place.name}</p>
        {place.address && (
          <p className="text-[10px] text-muted-foreground truncate">{place.address}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {place.rating && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
            {place.rating}
          </span>
        )}
        {googleUrl && (
          <a
            href={googleUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-emerald-600 hover:underline flex items-center gap-0.5"
          >
            Maps <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * NF-18 (v1.20.0) — public single-place view. Payload arrives with
 * google_data.reviews + place_profile already stripped server-side; this
 * view renders the safe subset: photo, name, category, rating, address,
 * opening hours, website/phone links, map pin, owner's note.
 */
function SharedPlaceView({
  data, isLoggedIn, onSave, saving, mapStyleUrl, markerStyle,
}: {
  data: SharedData; isLoggedIn: boolean; onSave: () => void; saving: boolean;
  mapStyleUrl: string; markerStyle: "icons" | "dots";
}) {
  const place = data.place;
  if (!place) return null;
  const gd = (place.google_data ?? {}) as Record<string, unknown>;
  const photo = (gd.photo_storage_url as string | undefined) ?? null;
  const rating = gd.rating as number | undefined;
  const ratingCount = gd.user_ratings_total as number | undefined;
  const hours = (gd.opening_hours as { weekday_text?: string[] } | undefined)
    ?.weekday_text;
  const website = gd.website as string | undefined;
  const mapsUrl = gd.url as string | undefined;

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <header className="p-4 border-b">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-sm">Map Organiser</span>
          </div>
          {isLoggedIn && (
            <Button size="sm" className="cursor-pointer" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save to my places
            </Button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full p-4 space-y-4 flex-1">
        {/* Photo */}
        {photo && (
          <div className="h-52 sm:h-64 rounded-xl overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={place.name} className="w-full h-full object-cover" />
          </div>
        )}

        {/* Title */}
        <div>
          <h1 className="text-xl font-semibold">{place.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            shared by {data.ownerName}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {place.category && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: place.category.color }}
              >
                {place.category.name}
              </span>
            )}
            {rating != null && (
              <span className="text-xs text-muted-foreground">
                ★ {rating}
                {ratingCount != null && ` (${ratingCount})`}
              </span>
            )}
          </div>
          {place.address && (
            <p className="text-sm text-muted-foreground mt-2">{place.address}</p>
          )}
          {place.notes && (
            <p className="text-sm mt-2 bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">
              {place.notes}
            </p>
          )}
        </div>

        {/* Map */}
        {place.location?.lat != null && (
          <div className="h-64 sm:h-80 rounded-xl overflow-hidden border">
            <MapView
              places={[place]}
              mapStyle={mapStyleUrl}
              markerStyle={markerStyle}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Hours + links */}
        {hours && hours.length > 0 && (
          <div className="text-sm">
            <p className="font-medium mb-1.5">Opening hours</p>
            <div className="space-y-0.5 text-muted-foreground text-xs">
              {hours.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline cursor-pointer">
              Website
            </a>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline cursor-pointer">
              View on Google Maps
            </a>
          )}
        </div>
      </div>

      <SharedFooter isLoggedIn={isLoggedIn} />
    </div>
  );
}

function SharedFooter({ isLoggedIn }: { isLoggedIn: boolean }) {
  if (isLoggedIn) return null;

  return (
    <footer className="border-t p-6 text-center">
      <p className="text-sm text-muted-foreground mb-2">
        Organize your own saved places
      </p>
      <a
        href="/signup"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors cursor-pointer"
      >
        <Compass className="h-4 w-4" />
        Create your free account
      </a>
    </footer>
  );
}
