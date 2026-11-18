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
  MapPin, Calendar, Star, Save, Loader2, ExternalLink, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import type { Place, PlanDay } from "@/lib/types";
import { googleMapsPlaceUrl } from "@/lib/google/maps-url";
import { formatDateRange, formatDayDate } from "@/lib/plans/dates";
import { dayColor } from "@/lib/plans/day-colors";

interface SharedData {
  type: "list" | "plan" | "place";
  slug: string;
  ownerName: string;
  list?: { id: string; name: string; description: string | null; color: string };
  /** A list's places in order; `list_note` is the owner's note on the place
   *  in this list ("what to order"). */
  places?: (Place & { list_note?: string | null })[];
  /** NF-18 (v1.20.0): single-place share payload (reviews/profile stripped server-side). */
  place?: Place;
  /** Whitelisted server-side (handlePlanShare): no costs, notes or outcomes. */
  plan?: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    status: "planned" | "cancelled";
    day_count: number;
    stop_count: number;
    days: PlanDay[];
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
              : `/plans/${result.id}`
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
  if (data.type === "plan") return <SharedPlanView data={data} isLoggedIn={isLoggedIn} onSave={handleSave} saving={saveContent.isPending} mapStyleUrl={mapStyleUrl} markerStyle={markerStyle} />;
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
            <PlaceRow key={place.id} place={place} index={i} note={place.list_note} />
          ))}
        </div>
      </div>

      {/* Footer CTA */}
    </div>
  );
}

function SharedPlanView({
  data, isLoggedIn, onSave, saving, mapStyleUrl, markerStyle,
}: {
  data: SharedData; isLoggedIn: boolean; onSave: () => void; saving: boolean;
  mapStyleUrl: string; markerStyle: "icons" | "dots";
}) {
  const plan = data.plan;
  if (!plan) return null;
  const days = plan.days || [];
  // The public payload carries the part of a place this view shows; MapView
  // and PlaceRow are typed for full rows.
  const allPlaces = days.flatMap((d) =>
    (d.stops || []).flatMap((s) => (s.place?.location ? [s.place] : []))
  ) as unknown as Place[];

  const routeLines = days.flatMap((d) =>
    d.route?.geometry?.coordinates
      ? [{ id: `route-${d.day_number}`, color: dayColor(d.day_number), coordinates: d.route.geometry.coordinates }]
      : []
  );

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
              Save to my plans
            </Button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full p-4 space-y-4 flex-1">
        {/* Title */}
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            {plan.name}
            {plan.status === "cancelled" && (
              <Badge variant="secondary" className="text-[10px] font-normal">Cancelled</Badge>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
            by {data.ownerName}
            {plan.start_date && (
              <>
                <span className="mx-0.5">·</span>
                {formatDateRange(plan.start_date, plan.end_date)}
              </>
            )}
            <span className="mx-0.5">·</span>
            <Calendar className="h-3 w-3" /> {plan.day_count}
            <span className="mx-0.5">·</span>
            <MapPin className="h-3 w-3" /> {plan.stop_count}
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
          {days.map((day) => {
            const color = dayColor(day.day_number);
            const stops = day.stops || [];

            return (
              <div key={day.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-6 w-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {day.day_number}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Day {day.day_number}</p>
                    {day.date && (
                      <p className="text-[10px] text-muted-foreground">{formatDayDate(day.date)}</p>
                    )}
                  </div>
                  {day.route && (
                    <span className="text-[10px] text-muted-foreground">
                      {day.route.distance_km} km · {day.route.duration_min} min
                    </span>
                  )}
                </div>
                <div className="pl-3 border-l-2 ml-3 space-y-0" style={{ borderColor: color }}>
                  {stops.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2 pl-2">Nothing planned for this day.</p>
                  )}
                  {stops.map((stop, j) => {
                    const leg = day.route?.legs.find((l) => l.from_stop_id === stop.id);
                    const when = stop.start_time ?? stop.day_part;
                    return (
                      <div key={stop.id}>
                        {stop.place ? (
                          <PlaceRow place={stop.place as unknown as Place} index={j} when={when} />
                        ) : (
                          <NoteRow title={stop.title ?? ""} index={j} when={when} />
                        )}
                        {leg && j < stops.length - 1 && (
                          <div className="flex items-center gap-1.5 pl-6 py-0.5">
                            <span className="text-[9px] text-muted-foreground">
                              {leg.distance_km} km · {leg.duration_min} min
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

/** A stop without a saved place — a meeting point, a note. */
function NoteRow({ title, index, when }: { title: string; index: number; when?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="text-xs font-medium text-muted-foreground w-5 text-center shrink-0">{index + 1}</span>
      <span className="h-5 w-5 rounded-full shrink-0 bg-muted flex items-center justify-center">
        <StickyNote className="h-3 w-3 text-muted-foreground" />
      </span>
      <p className="text-sm font-medium truncate min-w-0 flex-1">{title}</p>
      {when && <span className="text-[10px] text-muted-foreground border rounded px-1 py-px shrink-0">{when}</span>}
    </div>
  );
}

function PlaceRow({
  place,
  index,
  when,
  note,
}: {
  place: Place;
  index: number;
  when?: string | null;
  /** The owner's note on this place in the shared list. */
  note?: string | null;
}) {
  // Cross-platform Maps link (mobile app can't resolve the stored url).
  // Public payload strips google_place_id → name-search fallback.
  const googleUrl = googleMapsPlaceUrl(
    place.name,
    place.google_place_id,
    place.google_data?.url
  );

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
        {note && (
          <p className="mt-0.5 text-xs italic text-emerald-700 dark:text-emerald-400 whitespace-pre-line line-clamp-3">
            {note}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {when && (
          <span className="text-[10px] text-muted-foreground border rounded px-1 py-px">{when}</span>
        )}
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
  const mapsUrl = googleMapsPlaceUrl(
    place.name,
    place.google_place_id,
    gd.url as string | undefined
  );

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

    </div>
  );
}
