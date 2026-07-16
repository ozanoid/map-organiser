export type VisitStatus = "want_to_go" | "booked" | "visited" | "favorite";

export interface Place {
  id: string;
  user_id: string;
  google_place_id: string | null;
  name: string;
  address: string | null;
  country: string | null;
  city: string | null;
  location: { lat: number; lng: number };
  category_id: string | null;
  subcategory_id: string | null;
  rating: number | null;
  notes: string | null;
  visit_status: VisitStatus | null;
  visited_at: string | null;
  booked_at: string | null;
  google_data: GooglePlaceData;
  source: "manual" | "import" | "link" | "mapbox_search" | "similar" | "shared";
  created_at: string;
  updated_at: string;
  // Joined
  category?: Category;
  subcategory?: Subcategory;
  tags?: Tag[];
  lists?: PlaceList[];
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
}

export interface Subcategory {
  id: string;
  user_id: string;
  parent_category_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_pending: boolean;
  proposed_at: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

/** v1.20.0 (S2 F-03/NF-20/21) — saved filter preset / quick chip.
 *  query_string = filtersToQueryString output; ai_query non-null when
 *  saved from an AI search (chip re-runs the pipeline). */
export interface SavedFilter {
  id: string;
  user_id: string;
  name: string;
  query_string: string;
  ai_query: string | null;
  sort_order: number;
  created_at: string;
}

export interface PlaceList {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
  place_count?: number;
}

export interface Trip {
  id: string;
  user_id: string;
  list_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  days?: TripDay[];
  day_count?: number;
  place_count?: number;
}

export interface TripDay {
  id: string;
  trip_id: string;
  day_number: number;
  date: string;
  notes: string | null;
  created_at: string;
  // Joined
  places?: TripDayPlace[];
  route?: {
    distance_km: number;
    duration_min: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    legs?: Array<{ distance_km: number; duration_min: number }>;
  };
}

export interface TripDayPlace {
  id: string;
  trip_day_id: string;
  place_id: string;
  sort_order: number;
  time_slot: string | null;
  notes: string | null;
  created_at: string;
  // Joined
  place?: Place;
}

export interface PlacePhoto {
  id: string;
  place_id: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

export interface GoogleReview {
  rating: number;
  text: string;
  author_name: string;
  author_photo?: string;
  relative_time: string;
  publish_time?: string;
  /**
   * DataForSEO-only enrichment (v1.17.0, NF-06). Present only on reviews
   * fetched/merged AFTER the data-layer upgrade — older stored reviews
   * lack these until the place's reviews are refreshed. All optional;
   * UI must be empty-safe. Field paths verified against
   * docs.dataforseo.com (reviews task_get schema).
   */
  owner_answer?: string;
  /** "time ago" display string for the owner's reply (e.g. "2 months ago"). */
  owner_time_ago?: string;
  /** Direct image URLs from the review, capped at 6 for JSONB size discipline. */
  images?: string[];
  /** Author has Google "Local Guide" status. */
  local_guide?: boolean;
  /** Helpful votes on this review (rating.votes_count in the raw item). */
  votes_count?: number;
}

export interface GooglePlaceData {
  types?: string[];
  photos?: string[];
  photo_storage_url?: string; // Supabase Storage URL (replaces Google photo URLs)
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: {
    weekday_text?: string[];
    open_now?: boolean;
  };
  website?: string;
  phone?: string;
  price_level?: number;
  url?: string;
  reviews?: GoogleReview[];
  // DataForSEO extended fields (optional — only present when provider is dataforseo)
  provider?: "google" | "dataforseo";
  cid?: string;
  rating_distribution?: Record<string, number>;
  /** Days may be null — DataForSEO returns null for dataless days
   *  (type widened v1.18.0; the old cast hid it). */
  popular_times?: Record<
    string,
    Array<{ hour: number; popular_index: number }> | null
  >;
  /**
   * Structured week timetable (v1.18.0, open-now) — DataForSEO
   * work_hours.timetable passthrough. Day keys monday..sunday; a day may
   * be null (closed / no data). Feeds the render-time isOpenNow
   * computation (src/lib/places/open-now.ts).
   */
  work_timetable?: Record<
    string,
    Array<{
      open: { hour: number; minute: number };
      close: { hour: number; minute: number };
    }> | null
  >;
  /**
   * IANA timezone (v1.18.0) — derived ONCE server-side from coordinates
   * via tz-lookup at extraction. Open-now must be evaluated in the
   * PLACE's local time, never the viewer's.
   */
  tz?: string;
  place_topics?: Record<string, number>;
  attributes?: Record<string, boolean>;
  is_claimed?: boolean;
  current_status?: string;
  total_photos?: number;
  business_description?: string;
  book_online_url?: string;
  local_business_links?: Array<{ type: string; url: string; title?: string }>;
  /** v1.18.0: category + votes_count were previously dropped at
   *  transform — kept now for the SimilarPlaces cards ("Bakery · ★4.8
   *  (1.2k)"). Older rows gain them on refresh. */
  people_also_search?: Array<{
    title: string;
    cid?: string;
    rating?: number;
    category?: string;
    votes_count?: number;
  }>;
  enriched_at?: string;
  /** AI place profile (Phase 4). Carries lite or full completeness. Typed
   *  loosely here to avoid pulling the full Zod schema into client bundles;
   *  the consuming components cast to PlaceProfile from the schema. */
  place_profile?: Record<string, unknown>;
}

export interface PlaceFilters {
  country?: string;
  city?: string;
  category_ids?: string[];
  subcategory_ids?: string[];
  tag_ids?: string[];
  list_id?: string;
  rating_min?: number;
  google_rating_min?: number;
  visit_status?: VisitStatus;
  search?: string;
  sort?: string;
  /**
   * Dynamic "open now" (v1.18.0): evaluated at REQUEST TIME from
   * work_timetable + tz (see src/lib/places/open-now.ts) — a JS
   * post-filter in /api/places, not a SQL predicate. Places without
   * timetable/tz data are EXCLUDED when the filter is on (unknown ≠ open).
   */
  open_now?: boolean;
  // Phase 6.5 LLM-as-judge pivot: `soft_features` was removed entirely.
  // Soft matching now happens inside rank-results LLM, which reads
  // place_profile.features.* + theme_insights + tldr + pros/cons.
  // Old bookmark URLs with `?f_*` params are silently ignored by the
  // current useFilters parser. See docs/_plans/phase-6-llm-as-judge-pivot.md.
}

export interface ParsedPlaceData {
  placeId: string;
  name: string;
  address: string;
  country: string;
  city: string;
  lat: number;
  lng: number;
  types: string[];
  photos: string[];
  rating: number | null;
  openingHours: { weekday_text?: string[]; open_now?: boolean } | null;
  website: string | null;
  phone: string | null;
  photoRef?: string | null; // Google photo reference name (for download)
  priceLevel?: number | null;
  googleMapsUrl?: string | null;
}
