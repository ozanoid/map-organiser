import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
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

/** One place as the Takeout parser produces it. */
export interface ImportPayload {
  name: string;
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
}

export type ImportOutcome =
  | { status: "imported"; placeId: string; enriched: boolean }
  | { status: "skipped"; reason: string; placeId?: string }
  | { status: "failed"; reason: string };

/** Google Maps radius bias for the business-info lookup, in metres. */
const LOOKUP_RADIUS_M = 1000;

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
export async function resolveIdentity(payload: ImportPayload): Promise<PlaceIdentity> {
  let lat = payload.lat ?? null;
  let lng = payload.lng ?? null;
  let cid: string | null = null;
  let placeId: string | null = null;
  let keyword = payload.name;

  if (payload.googleMapsUrl) {
    const parsed = await parseMapsUrl(payload.googleMapsUrl);
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

  let address = payload.address ?? null;
  let country: string | null = null;
  let city: string | null = null;
  let { lat, lng } = identity;
  let googlePlaceId: string | null = null;
  let categoryId: string | null = null;
  let photoRef: string | null = null;
  let googleData: Record<string, unknown> = {};

  const raw = await fetchBusinessInfoLive(client, {
    keyword: identity.keyword,
    location_coordinate: identity.locationCoordinate,
  });
  await trackUsage(userId, "dataforseo_business_info_live");

  if (raw) {
    const placeData = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);
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
      categoryId = resolveCategoryId(placeData.types, userCategories, payload.name);
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
      name: payload.name,
      address,
      country,
      city,
      location: `POINT(${lng} ${lat})`,
      notes: payload.note ?? null,
      google_place_id: googlePlaceId,
      google_data: googleData,
      category_id: categoryId,
      source: "import",
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
    return { status: "failed", reason: error?.message || "Insert failed" };
  }

  if (photoRef) {
    const url = await downloadAndStorePhotoFromUrl(
      supabase,
      photoRef,
      inserted.id,
      userId
    );
    if (url) {
      await supabase
        .from("places")
        .update({ google_data: { ...googleData, photo_storage_url: url } })
        .eq("id", inserted.id);
    }
  }

  const listIds = defaults.listIds ?? [];
  const tagIds = defaults.tagIds ?? [];
  if (listIds.length > 0) {
    await supabase
      .from("list_places")
      .insert(listIds.map((lid) => ({ list_id: lid, place_id: inserted.id })));
  }
  if (tagIds.length > 0) {
    await supabase
      .from("place_tags")
      .insert(tagIds.map((tid) => ({ tag_id: tid, place_id: inserted.id })));
  }

  return { status: "imported", placeId: inserted.id, enriched: Boolean(raw) };
}
