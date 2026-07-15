/**
 * Transform DataForSEO raw responses → app-compatible types.
 *
 * This is the most critical file in the DataForSEO integration:
 * it ensures the rest of the app sees the exact same ParsedPlaceData
 * and GoogleReview[] shapes regardless of which provider is active.
 */

import tzLookup from "tz-lookup";
import type { ParsedPlaceData, GoogleReview, GooglePlaceData } from "@/lib/types";
import type { RawBusinessInfo, RawReview } from "./api-types";
import { dataforseoCategoriesToGoogleTypes } from "./category-adapter";
import { convertWorkTimeToOpeningHours } from "./opening-hours-adapter";
import { convertPriceLevel } from "./price-level-adapter";

/**
 * Coordinate → IANA timezone, computed ONCE at extraction (server-side —
 * every transform.ts importer is a route/server lib, so the ~70KB
 * tz-lookup table never reaches a client bundle). tz-lookup throws
 * RangeError on out-of-range coords — degrade to undefined.
 */
function safeTz(
  lat: number | null | undefined,
  lng: number | null | undefined
): string | undefined {
  if (lat == null || lng == null) return undefined;
  try {
    return tzLookup(lat, lng);
  } catch {
    return undefined;
  }
}

// ISO 3166-1 alpha-2 → country name (common countries)
const COUNTRY_CODE_MAP: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  UK: "United Kingdom",
  TR: "Turkey",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  PT: "Portugal",
  GR: "Greece",
  AT: "Austria",
  CH: "Switzerland",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czech Republic",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  HR: "Croatia",
  IE: "Ireland",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  TW: "Taiwan",
  TH: "Thailand",
  VN: "Vietnam",
  IN: "India",
  AU: "Australia",
  NZ: "New Zealand",
  CA: "Canada",
  MX: "Mexico",
  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  EG: "Egypt",
  MA: "Morocco",
  ZA: "South Africa",
  RU: "Russia",
  UA: "Ukraine",
  IL: "Israel",
  SG: "Singapore",
  MY: "Malaysia",
  ID: "Indonesia",
  PH: "Philippines",
};

function resolveCountryName(code: string | null): string {
  if (!code) return "";
  return COUNTRY_CODE_MAP[code.toUpperCase()] || code;
}

/**
 * Transform DataForSEO RawBusinessInfo → ParsedPlaceData.
 * Output matches the exact structure that Google adapter produces.
 */
export function transformBusinessInfoToPlaceData(
  raw: RawBusinessInfo
): ParsedPlaceData {
  const types = dataforseoCategoriesToGoogleTypes(
    raw.category,
    raw.additional_categories
  );

  const openingHours = convertWorkTimeToOpeningHours(raw.work_time);
  const priceLevel = convertPriceLevel(raw.price_level);

  // Construct Google Maps URL from place_id or cid
  let googleMapsUrl: string | null = null;
  if (raw.place_id) {
    googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${raw.place_id}`;
  } else if (raw.cid) {
    googleMapsUrl = `https://www.google.com/maps?cid=${raw.cid}`;
  }

  const countryName = resolveCountryName(raw.address_info?.country_code ?? null);
  const refinedCity = refineCity(
    raw.address_info?.city || "",
    raw.address || "",
    raw.address_info?.country_code ?? null
  );

  return {
    placeId: raw.place_id || raw.cid || "",
    name: raw.title || "",
    address: raw.address || "",
    country: countryName,
    city: refinedCity,
    lat: raw.latitude || 0,
    lng: raw.longitude || 0,
    types,
    photos: [],
    photoRef: raw.main_image || null,
    rating: raw.rating?.value ?? null,
    openingHours,
    website: raw.url || null,
    phone: raw.phone || null,
    priceLevel,
    googleMapsUrl,
  };
}

/**
 * DataForSEO returns the locality field as `address_info.city`, but for some
 * countries it returns an administrative region name instead of the actual
 * city name. The known offenders:
 *
 *   - UK: returns "England" / "Scotland" / "Wales" / "Northern Ireland"
 *         instead of the postal town.
 *
 * When we detect a known bad value, we re-extract the real city from the
 * address string. The regex anchors on the country-specific postcode
 * format which is reliably present at the end of the address.
 *
 * If we can't extract, fall back to the original value (better than empty).
 */
function refineCity(
  rawCity: string,
  address: string,
  countryCode: string | null
): string {
  const c = rawCity.trim();
  const cc = (countryCode || "").toUpperCase();

  // UK fix
  if ((cc === "GB" || cc === "UK") && UK_ADMIN_REGIONS.has(c)) {
    const m = address.match(UK_CITY_FROM_ADDRESS_RE);
    if (m && m[1]) return m[1].trim();
  }

  return c;
}

const UK_ADMIN_REGIONS = new Set([
  "England",
  "Scotland",
  "Wales",
  "Northern Ireland",
]);

/**
 * Capture the locality token that appears right before the UK postcode
 * and the trailing ", UK". Tested against 174 real addresses for
 * extraction rate 174/174. Handles compound city names ("Brighton and
 * Hove"), apostrophes, and embedded neighborhood commas like "Finsbury
 * Park, London". The capture is non-greedy and anchored on the postcode.
 */
const UK_CITY_FROM_ADDRESS_RE =
  /(?:^|,\s*)([A-Za-z][A-Za-z\s'.-]*?)\s+[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\s*,\s*UK\s*$/;

/**
 * Extract DataForSEO-exclusive fields for storage in google_data JSONB.
 * These fields provide extra value beyond what Google Places API offers.
 */
/**
 * Drop undefined-valued keys before returning. Object spread COPIES
 * own props with value undefined, and JSONB serialization then DROPS
 * those keys — so `{...stored, ...extended}` merge paths (enrich,
 * refresh) would silently strip previously-stored values whenever a
 * degraded crawl returns nulls (e.g. work_time null → work_timetable
 * gone → the place loses open-now until a future good crawl). Stale
 * beats lost.
 */
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export function extractExtendedData(
  raw: RawBusinessInfo
): Partial<GooglePlaceData> {
  // Flatten attributes into a boolean map
  const attributes: Record<string, boolean> = {};
  if (raw.attributes?.available_attributes) {
    for (const [group, items] of Object.entries(
      raw.attributes.available_attributes
    )) {
      if (Array.isArray(items)) {
        for (const item of items) {
          attributes[item] = true;
        }
      } else {
        attributes[group] = true;
      }
    }
  }
  if (raw.attributes?.unavailable_attributes) {
    for (const [group, items] of Object.entries(
      raw.attributes.unavailable_attributes
    )) {
      if (Array.isArray(items)) {
        for (const item of items) {
          attributes[item] = false;
        }
      } else {
        attributes[group] = false;
      }
    }
  }

  return omitUndefined({
    provider: "dataforseo" as const,
    cid: raw.cid || undefined,
    rating_distribution: raw.rating_distribution || undefined,
    popular_times: (raw.popular_times as GooglePlaceData["popular_times"]) || undefined,
    // v1.18.0 open-now: keep the STRUCTURED timetable (previously only
    // converted to weekday_text and discarded) + the place's IANA tz so
    // isOpenNow can be computed at render/filter time in LOCAL time.
    work_timetable:
      (raw.work_time?.work_hours?.timetable as GooglePlaceData["work_timetable"]) ||
      undefined,
    tz: safeTz(raw.latitude, raw.longitude),
    place_topics: raw.place_topics || undefined,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    is_claimed: raw.is_claimed ?? undefined,
    // Path verified against DataForSEO docs: current_status is nested in
    // work_hours (the old `work_time.current_status` read never matched —
    // 0/471 places had the field before this fix).
    current_status: raw.work_time?.work_hours?.current_status || undefined,
    total_photos: raw.total_photos || undefined,
    business_description: raw.description || raw.snippet || undefined,
    book_online_url: raw.book_online_url || undefined,
    local_business_links:
      raw.local_business_links?.map((l) => ({
        type: l.type || "link",
        url: l.url || "",
        title: l.title || undefined,
      })) || undefined,
    people_also_search:
      raw.people_also_search?.map((p) => ({
        title: p.title || "",
        cid: p.cid || undefined,
        rating: p.rating?.value,
      })) || undefined,
    enriched_at: new Date().toISOString(),
  });
}

/**
 * Transform DataForSEO RawReview[] → GoogleReview[].
 * Matches the exact interface the UI expects.
 */
export function transformReviews(rawReviews: RawReview[]): GoogleReview[] {
  return rawReviews
    .filter((r) => r.review_text || r.original_review_text)
    .map((r) => {
      // ONLY image_url — it's the direct image file. The `url` field is
      // the Google Maps viewer PAGE (HTML), which can never render in an
      // <img>; persisting it would just produce broken thumbnails. Cap
      // 6/review — google_data size discipline (~120 chars/URL).
      const images = (r.images ?? [])
        .map((img) => img.image_url || "")
        .filter(Boolean)
        .slice(0, 6);
      return {
        rating: r.rating?.value ?? 0,
        text: r.review_text || r.original_review_text || "",
        author_name: r.profile_name || "Anonymous",
        author_photo: r.profile_image_url || undefined,
        relative_time: r.time_ago || "",
        publish_time: r.timestamp || undefined,
        // NF-06 enrichment — omit-when-empty keeps stored JSONB lean.
        owner_answer: r.owner_answer || undefined,
        owner_time_ago: r.owner_time_ago || undefined,
        images: images.length > 0 ? images : undefined,
        local_guide: r.local_guide || undefined,
        votes_count: r.rating?.votes_count || undefined,
      };
    });
}

/** First N stored positions form the protected relevance backbone. */
export const REVIEW_BACKBONE_SIZE = 50;

/** Stable identity for a review across fetches. */
const reviewKey = (r: GoogleReview) =>
  r.publish_time
    ? `${r.publish_time}|${r.author_name}`
    : `${r.author_name}|${r.text.slice(0, 60)}`;

const newestFirst = (a: GoogleReview, b: GoogleReview) =>
  (b.publish_time ?? "").localeCompare(a.publish_time ?? "");

/**
 * Count how many incoming reviews are genuinely new (not in the stored
 * set). Key-diff based, NOT length-delta based — once the corpus is at
 * cap, a length delta reads 0 even when new reviews arrived and evicted
 * old pool entries.
 */
export function countNewReviews(
  existing: GoogleReview[],
  incoming: GoogleReview[]
): number {
  const have = new Set(existing.map(reviewKey));
  const seen = new Set<string>();
  let n = 0;
  for (const r of incoming) {
    const k = reviewKey(r);
    if (have.has(k) || seen.has(k)) continue;
    seen.add(k);
    n++;
  }
  return n;
}

/**
 * Merge a fresh review fetch into the stored set instead of replacing it.
 *
 * Structure of the stored array — TWO tiers, one array:
 *
 *   [ backbone: first ≤50 positions ][ pool: rolling newest-first window ]
 *
 * The BACKBONE is Google's relevance-ordered "most valuable" picks. Its
 * ORDER IS the ranking, so it is never reshuffled or evicted by newest
 * fetches. Recency ≠ signal quality: a profile built from "newest 50"
 * alone would be worse than one built from the relevant set, so the
 * backbone is the permanent quality floor.
 *
 * `incomingOrder` MUST reflect the sort the fetch used:
 *
 * - "relevant": the incoming set IS the current relevance ranking → it
 *   ESTABLISHES (or refreshes) the backbone in its fetch order. Whatever
 *   was stored before — legacy 5-review heads, a corpus first populated
 *   by a newest fetch — is demoted to the pool, not lost. This also makes
 *   the initial population correct (empty `existing` + relevant fetch →
 *   backbone = the relevant order, untouched).
 * - "newest": discovery refresh → existing positions are preserved
 *   (backbone untouched), genuinely new reviews join the pool.
 *
 * The POOL is a newest-first window capped so total storage stays ≤ cap.
 * The profile prompt blends both tiers — see selectReviewsForPrompt in
 * prompts/place-profile-full.ts.
 *
 * Identity: publish_time + author_name (falls back to author + text
 * prefix for legacy reviews without a timestamp). A re-fetched copy of a
 * known review updates it in place.
 *
 * Known imperfection (accepted): the tier boundary is positional. For
 * corpora that never had ≥50 relevant reviews, later "newest" merges can
 * freeze a few pool entries into the sub-50 head — harmless, because a
 * ≤50-review corpus fits the prompt whole anyway.
 */
export function mergeReviews(
  existing: GoogleReview[],
  incoming: GoogleReview[],
  opts: { incomingOrder: "relevant" | "newest"; cap?: number }
): GoogleReview[] {
  const cap = opts.cap ?? 200;

  if (opts.incomingOrder === "relevant") {
    // Incoming is the fresh relevance ranking → it becomes the backbone.
    const seen = new Set<string>();
    const backbone: GoogleReview[] = [];
    const overflow: GoogleReview[] = [];
    for (const r of incoming) {
      const k = reviewKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (backbone.length < REVIEW_BACKBONE_SIZE) backbone.push(r);
      else overflow.push(r);
    }
    const demoted: GoogleReview[] = [];
    for (const r of existing) {
      const k = reviewKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      demoted.push(r);
    }
    const pool = [...demoted, ...overflow]
      .sort(newestFirst)
      .slice(0, Math.max(0, cap - backbone.length));
    return [...backbone, ...pool];
  }

  // "newest": existing entries keep their positions; fresh copies win in
  // place; genuinely new reviews join the pool.
  const freshByKey = new Map(incoming.map((r) => [reviewKey(r), r] as const));
  const seen = new Set<string>();
  const updatedExisting: GoogleReview[] = [];
  for (const r of existing) {
    const k = reviewKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    updatedExisting.push(freshByKey.get(k) ?? r);
  }
  const additions: GoogleReview[] = [];
  for (const r of incoming) {
    const k = reviewKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    additions.push(r);
  }

  const backbone = updatedExisting.slice(0, REVIEW_BACKBONE_SIZE);
  const pool = [...updatedExisting.slice(REVIEW_BACKBONE_SIZE), ...additions]
    .sort(newestFirst)
    .slice(0, Math.max(0, cap - backbone.length));
  return [...backbone, ...pool];
}

// transformExtendedReviews removed (v1.17.0): it was dead code — zero
// callers since Phase 4. Its useful fields (owner_answer, images,
// local_guide, votes_count) now live directly on GoogleReview via
// transformReviews above, so they flow through mergeReviews and persist.
