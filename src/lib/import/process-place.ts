import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMapsUrl, type ParseMapsUrlOptions } from "@/lib/google/parse-maps-url";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { trackUsage } from "@/lib/google/track-usage";
import type { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import type { Category } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";
import { addPlaceToLists } from "@/lib/lists/write";
import { isUniqueViolation } from "@/lib/db/errors";
import { log } from "@/lib/telemetry/logger";

/** One place to add: what the Takeout parser, the Instagram reader or the
 *  assistant's add hands the import. */
export interface ImportPayload {
  /** The place's name. The assistant's add has only a Google id or a Maps
   *  link — Google's name is used then. */
  name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  googleMapsUrl?: string | null;
  note?: string | null;
}

export interface ImportDefaults {
  visitStatus?: string | null;
  listIds?: string[];
  tagIds?: string[];
  /** `places.source` for the new row; Takeout imports leave it as "import". */
  source?: "import" | "instagram" | "assistant";
  /**
   * Add only a place Google Maps has a record of: no record → skipped
   * NOT_ON_GOOGLE_MAPS, no thin row built from the URL's coordinates. The
   * assistant's add sets it. Takeout and Instagram keep the default: when
   * Google has no record, a saved coordinate is worth a thin row.
   *
   * A failed lookup throws in every mode (v1.45.0; before, outside this mode
   * it read as "no record" and kept a thin row for good) — the queue retries
   * the item.
   */
  requireLookup?: boolean;
  /** Bounds the business-info lookup — the assistant answers within one call. */
  signal?: AbortSignal;
}

/** Skip reason when Google Maps (through DataForSEO) has no such place. */
export const NOT_ON_GOOGLE_MAPS = "Not on Google Maps";

export type ImportOutcome =
  | { status: "imported"; placeId: string; enriched: boolean }
  | { status: "skipped"; reason: string; placeId?: string }
  | { status: "failed"; reason: string };

/** Google Maps radius bias for the business-info lookup, in metres. */
const LOOKUP_RADIUS_M = 1000;

/** How far a name-search hit may sit from the saved coordinate before it is
 *  treated as a different venue. Well inside the 1 km lookup bias, so a second
 *  branch of the same chain cannot be mistaken for the one that was saved. */
const NAME_FALLBACK_MAX_KM = 0.2;

/**
 * Pull a CID out of a Maps URL by pattern alone.
 *
 * Handles the `?cid=` form and the `!1s0x…:0x…` / `ftid=` hex pair, which
 * `parseMapsUrl` does not always surface. Pure string work — no network call.
 */
export function extractCidFromUrl(url: string): string | null {
  const cidParam = url.match(/[?&]cid=(\d+)/);
  if (cidParam) return cidParam[1];
  const ftidMatch =
    url.match(/!1s0x[a-f0-9]+:(0x[a-f0-9]+)/) || url.match(/ftid=0x[a-f0-9]+:(0x[a-f0-9]+)/);
  if (ftidMatch) {
    try {
      return BigInt(ftidMatch[1]).toString();
    } catch {}
  }
  return null;
}

export interface PlaceIdentity {
  /** DataForSEO `keyword`: `cid:…`, `place_id:…`, or a free-text query. */
  keyword: string;
  cid: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  locationCoordinate?: string;
}

/**
 * Everything we can learn about a place before spending a DataForSEO call.
 *
 * Short links cost one HTTP redirect follow to resolve (free); everything else
 * is regex over the URL. The CID and place_id this yields are what make the
 * duplicate pre-check possible.
 */
export async function resolveIdentity(
  payload: ImportPayload,
  opts: ParseMapsUrlOptions = {}
): Promise<PlaceIdentity> {
  let lat = payload.lat ?? null;
  let lng = payload.lng ?? null;
  let cid: string | null = null;
  let placeId: string | null = null;
  let keyword = payload.name?.trim() ?? "";

  if (payload.googleMapsUrl) {
    const parsed = await parseMapsUrl(payload.googleMapsUrl, opts);
    // parseMapsUrl follows short links, so prefer the resolved URL — a
    // maps.app.goo.gl link carries no CID until it has been expanded.
    cid =
      parsed.cid ??
      extractCidFromUrl(parsed.resolvedUrl ?? payload.googleMapsUrl) ??
      null;
    placeId = parsed.placeId ?? null;

    if (cid) keyword = `cid:${cid}`;
    else if (placeId) keyword = `place_id:${placeId}`;
    else if (parsed.query) keyword = parsed.query;

    lat = parsed.lat ?? lat;
    lng = parsed.lng ?? lng;
  }

  return {
    keyword,
    cid,
    placeId,
    lat,
    lng,
    locationCoordinate:
      lat != null && lng != null ? `${lat},${lng},${LOOKUP_RADIUS_M}` : undefined,
  };
}

/**
 * Does this place already exist for the user, judged without an API call?
 *
 * This is the whole point of resolving identity first. The old flow checked for
 * duplicates on `google_place_id`, which only exists once DataForSEO has
 * answered — so a re-run of a 330-place file paid for 330 lookups before
 * concluding it had nothing to do. Matching on the URL's own CID or place_id
 * makes a resumed import free for everything already landed.
 */
export async function findExisting(
  supabase: SupabaseClient,
  userId: string,
  identity: Pick<PlaceIdentity, "cid" | "placeId">
): Promise<string | null> {
  if (identity.placeId) {
    const { data } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", userId)
      .eq("google_place_id", identity.placeId)
      .maybeSingle();
    if (data) return data.id as string;
  }
  if (identity.cid) {
    const { data } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", userId)
      .eq("google_data->>cid", identity.cid)
      .maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

/**
 * Make sure a place has its photo in Storage.
 *
 * Runs as the drain's `photo` stage rather than inline in the insert, so a
 * failure is a retryable queue item instead of a swallowed `null`.
 *
 * Free when `google_data.main_image` is present — just a CDN fetch and an
 * upload. Places imported before that field was persisted have no source URL
 * left, so recovering their photo costs one business-info lookup; the URL is
 * stored on the way through, and the second attempt is free.
 */
export async function ensurePlacePhoto(
  supabase: SupabaseClient,
  client: DataForSEOClient,
  userId: string,
  placeId: string
): Promise<"stored" | "already" | "unavailable"> {
  const { data: place } = await supabase
    .from("places")
    .select("google_data, google_place_id, country")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  if (!place) return "unavailable";

  const gd = (place.google_data as Record<string, unknown>) ?? {};
  if (gd.photo_storage_url) return "already";

  let imageUrl = gd.main_image as string | undefined;

  if (!imageUrl) {
    const gpid = place.google_place_id as string | null;
    if (!gpid) return "unavailable";
    const raw = await fetchBusinessInfoLive(client, {
      keyword: gpid.startsWith("ChIJ") ? `place_id:${gpid}` : `cid:${gpid}`,
      location_name: (place.country as string | null) ?? undefined,
    });
    await trackUsage(userId, "dataforseo_business_info_live", supabase);
    imageUrl = raw?.main_image ?? undefined;
    if (!imageUrl) return "unavailable";
    gd.main_image = imageUrl;
  }

  const url = await downloadAndStorePhotoFromUrl(supabase, imageUrl, placeId, userId);
  if (!url) return "unavailable";

  // Re-read rather than reuse `gd`: the reviews stage may have written to
  // google_data while the CDN fetch was in flight.
  const { data: cur } = await supabase
    .from("places")
    .select("google_data")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  await supabase
    .from("places")
    .update({
      google_data: {
        ...((cur?.google_data as Record<string, unknown>) ?? {}),
        main_image: imageUrl,
        photo_storage_url: url,
      },
    })
    .eq("id", placeId)
    .eq("user_id", userId);

  return "stored";
}

/**
 * Enrich and insert a single place.
 *
 * Extracted from the old `/api/places/import-batch` handler so the durable
 * drain and any future caller run identical logic. The behavioural changes
 * against that handler are the duplicate pre-check above and storing the
 * URL-derived CID (see below).
 */
export async function importPlace(
  supabase: SupabaseClient,
  client: DataForSEOClient,
  userId: string,
  payload: ImportPayload,
  defaults: ImportDefaults,
  userCategories: Category[] | null
): Promise<ImportOutcome> {
  const identity = await resolveIdentity(payload);

  const already = await findExisting(supabase, userId, identity);
  if (already) {
    return { status: "skipped", reason: "Already exists", placeId: already };
  }
  // Nothing to look up by: no Google id, no query, no name.
  if (!identity.keyword) {
    return { status: "skipped", reason: NOT_ON_GOOGLE_MAPS };
  }

  const givenName = payload.name?.trim() || null;
  let name = givenName;
  let address = payload.address ?? null;
  let country: string | null = null;
  let city: string | null = null;
  let { lat, lng } = identity;
  let googlePlaceId: string | null = null;
  let categoryId: string | null = null;
  let photoRef: string | null = null;
  let googleData: Record<string, unknown> = {};

  const lookup = { signal: defaults.signal };
  let raw = await fetchBusinessInfoLive(
    client,
    { keyword: identity.keyword, location_coordinate: identity.locationCoordinate },
    lookup
  );
  await trackUsage(userId, "dataforseo_business_info_live", supabase);

  // A `cid:` DataForSEO holds no record for returns nothing at all, and the
  // place then lands with a name, a coordinate and nothing else: no address, no
  // rating, no image, so no photo, no reviews, no profile and no tags. Measured
  // at 2 of 286 on one import — rare, silent, and permanent.
  //
  // Retry by name, and only when we have a coordinate to bound it with: a bare
  // name search would happily return a same-named place in another city. Even
  // so the answer is verified below before it is trusted.
  if (!raw && givenName && identity.locationCoordinate && identity.keyword !== givenName) {
    raw = await fetchBusinessInfoLive(
      client,
      { keyword: givenName, location_coordinate: identity.locationCoordinate },
      lookup
    );
    await trackUsage(userId, "dataforseo_business_info_live", supabase);

    // The coordinate is a bias, not a filter, and chains put two branches
    // inside one radius. Anything further than NAME_FALLBACK_MAX_KM from the
    // place the user actually saved is a different venue — better to keep a
    // thin record than a confident wrong one.
    if (raw) {
      const hit = transformBusinessInfoToPlaceData(raw);
      const off =
        hit.lat != null && hit.lng != null && lat != null && lng != null
          ? haversineDistance(lat, lng, hit.lat, hit.lng)
          : Infinity;
      if (off > NAME_FALLBACK_MAX_KM) raw = null;
    }
  }

  // The assistant's add: a place Google doesn't know isn't added at all.
  if (!raw && defaults.requireLookup) {
    return { status: "skipped", reason: NOT_ON_GOOGLE_MAPS };
  }

  if (raw) {
    const placeData = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);
    name = name || placeData.name || null;
    googlePlaceId = placeData.placeId || null;
    address = placeData.address || address;
    country = placeData.country || country;
    city = placeData.city || city;
    lat = placeData.lat || lat;
    lng = placeData.lng || lng;
    photoRef = placeData.photoRef ?? null;
    googleData = {
      types: placeData.types,
      rating: placeData.rating,
      user_ratings_total: raw.rating?.votes_count,
      opening_hours: placeData.openingHours,
      website: placeData.website,
      phone: placeData.phone,
      price_level: placeData.priceLevel,
      url: placeData.googleMapsUrl,
      ...extended,
    };
    if (placeData.types?.length && userCategories?.length) {
      categoryId = resolveCategoryId(placeData.types, userCategories, name ?? undefined);
    }
  }

  // Keep the CID we derived from the URL when DataForSEO did not return one.
  // Only 148 of 471 previously-imported places carry a `cid`, which blinds the
  // pre-check above on a re-run; persisting ours closes that gap going forward.
  if (identity.cid && !googleData.cid) googleData.cid = identity.cid;

  // Keep the source image URL, not just the stored copy. When the download or
  // the Storage upload fails, the only record of what to fetch used to be the
  // DataForSEO response we had already thrown away — so recovering one photo
  // meant paying for a whole business-info lookup again. 23 places needed
  // exactly that after the drain ran without a session-scoped Storage client.
  if (photoRef) googleData.main_image = photoRef;

  if (!lat || !lng) {
    return { status: "skipped", reason: "No coordinates" };
  }
  if (!name) {
    return { status: "skipped", reason: "No name" };
  }

  // The lookup can resolve to a place already held under a different URL, so
  // re-check with the authoritative id before inserting.
  if (googlePlaceId) {
    const dupe = await findExisting(supabase, userId, {
      placeId: googlePlaceId,
      cid: null,
    });
    if (dupe) return { status: "skipped", reason: "Already exists", placeId: dupe };
  }

  const { data: inserted, error } = await supabase
    .from("places")
    .insert({
      user_id: userId,
      name,
      address,
      country,
      city,
      location: `POINT(${lng} ${lat})`,
      notes: payload.note ?? null,
      google_place_id: googlePlaceId,
      google_data: googleData,
      category_id: categoryId,
      source: defaults.source ?? "import",
      ...(defaults.visitStatus && { visit_status: defaults.visitStatus }),
      ...(defaults.visitStatus === "visited" && {
        visited_at: new Date().toISOString(),
      }),
      ...(defaults.visitStatus === "booked" && {
        booked_at: new Date().toISOString(),
      }),
    })
    .select("id")
    .single();

  if (error || !inserted) {
    // Another add of the same place got there first, between the check above
    // and this insert (places_user_google_place_id_key).
    if (isUniqueViolation(error) && googlePlaceId) {
      const winner = await findExisting(supabase, userId, { placeId: googlePlaceId, cid: null });
      if (winner) return { status: "skipped", reason: "Already exists", placeId: winner };
    }
    return { status: "failed", reason: error?.message || "Insert failed" };
  }

  // The photo is NOT downloaded here — the drain's `photo` stage does it, using
  // the `main_image` stored above. Inline, a failed download left no record and
  // no way to retry, which is how a whole import landed without pictures.

  const listIds = defaults.listIds ?? [];
  const tagIds = defaults.tagIds ?? [];
  if (listIds.length > 0) {
    // Through the list write path (src/lib/lists): at the end of each list,
    // ownership checked. As before, a list problem doesn't fail the import.
    await addPlaceToLists({ supabase, userId }, inserted.id, listIds).catch((e) =>
      log.warn("import.lists_failed", { userId, error: e instanceof Error ? e.message : String(e) })
    );
  }
  if (tagIds.length > 0) {
    await supabase
      .from("place_tags")
      .insert(tagIds.map((tid) => ({ tag_id: tid, place_id: inserted.id })));
  }

  return { status: "imported", placeId: inserted.id, enriched: Boolean(raw) };
}
