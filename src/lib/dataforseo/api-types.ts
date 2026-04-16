/**
 * DataForSEO raw API response type definitions.
 * Based on docs.dataforseo.com/v3/business_data/google/
 */

// ──────────────────────────────────────────────────────────
// Shared wrapper types
// ──────────────────────────────────────────────────────────

export interface DataForSEOResponse<T> {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: DataForSEOTask<T>[];
}

export interface DataForSEOTask<T> {
  id: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  result_count: number;
  path: string[];
  data: Record<string, unknown>;
  result: T[] | null;
}

// ──────────────────────────────────────────────────────────
// My Business Info
// ──────────────────────────────────────────────────────────

export interface BusinessInfoResult {
  keyword: string;
  se_domain: string;
  location_code: number;
  language_code: string;
  check_url: string;
  datetime: string;
  item_types: string[];
  items_count: number;
  items: RawBusinessInfo[];
}

export interface RawBusinessInfo {
  type: string;
  rank_group: number;
  rank_absolute: number;
  position: string;
  title: string;
  original_title: string | null;
  description: string | null;
  category: string | null;
  category_ids: string[] | null;
  additional_categories: string[] | null;
  cid: string | null;
  feature_id: string | null;
  place_id: string | null;
  address: string | null;
  address_info: RawAddressInfo | null;
  phone: string | null;
  url: string | null;
  domain: string | null;
  contact_url: string | null;
  latitude: number | null;
  longitude: number | null;
  logo: string | null;
  main_image: string | null;
  total_photos: number | null;
  snippet: string | null;
  rating: RawRating | null;
  rating_distribution: Record<string, number> | null;
  work_time: RawWorkTime | null;
  popular_times: RawPopularTimes | null;
  place_topics: Record<string, number> | null;
  attributes: RawAttributes | null;
  people_also_search: RawPeopleAlsoSearch[] | null;
  is_claimed: boolean | null;
  local_business_links: RawLocalBusinessLink[] | null;
  book_online_url: string | null;
  price_level: string | null;
  hotel_rating: number | null;
  is_directory_item: boolean | null;
  directory: unknown[] | null;
  contributor_url: string | null;
}

export interface RawAddressInfo {
  borough: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  region: string | null;
  country_code: string | null;
}

export interface RawRating {
  rating_type: string;
  value: number;
  votes_count: number;
  rating_max: number;
}

export interface RawWorkTime {
  work_hours: RawWorkHours | null;
  current_status: string | null;
}

export interface RawWorkHours {
  timetable: Record<string, RawTimeSlot[] | null> | null;
}

export interface RawTimeSlot {
  open: { hour: number; minute: number };
  close: { hour: number; minute: number };
}

export type RawPopularTimes = Record<
  string,
  Array<{ hour: number; popular_index: number }> | null
>;

export interface RawAttributes {
  available_attributes?: Record<string, string[]> | null;
  unavailable_attributes?: Record<string, string[]> | null;
}

export interface RawPeopleAlsoSearch {
  title: string | null;
  cid: string | null;
  feature_id: string | null;
  rating: RawRating | null;
  category: string | null;
}

export interface RawLocalBusinessLink {
  type: string | null;
  title: string | null;
  url: string | null;
}

// ──────────────────────────────────────────────────────────
// Reviews
// ──────────────────────────────────────────────────────────

export interface ReviewsResult {
  keyword: string;
  type: string;
  se_domain: string;
  location_code: number;
  language_code: string;
  check_url: string;
  datetime: string;
  title: string;
  sub_title: string | null;
  rating: RawRating | null;
  feature_id: string | null;
  place_id: string | null;
  cid: string | null;
  reviews_count: number;
  items_count: number;
  items: RawReview[];
}

export interface RawReview {
  type: string;
  rank_group: number;
  rank_absolute: number;
  position: string;
  xpath: string | null;
  review_id: string | null;
  review_text: string | null;
  original_review_text: string | null;
  original_language: string | null;
  time_ago: string | null;
  timestamp: string | null;
  rating: RawRating | null;
  profile_name: string | null;
  profile_url: string | null;
  profile_image_url: string | null;
  reviews_count: number | null;
  photos_count: number | null;
  local_guide: boolean | null;
  images: RawReviewImage[] | null;
  owner_answer: string | null;
  original_owner_answer: string | null;
  owner_time_ago: string | null;
  owner_timestamp: string | null;
  review_url: string | null;
  review_highlights: unknown[] | null;
}

export interface RawReviewImage {
  type: string;
  alt: string | null;
  url: string | null;
  image_url: string | null;
}

// ──────────────────────────────────────────────────────────
// Type aliases for endpoint responses
// ──────────────────────────────────────────────────────────

export type BusinessInfoResponse = DataForSEOResponse<BusinessInfoResult>;
export type BusinessInfoTaskPostResponse = DataForSEOResponse<null>;
export type ReviewsResponse = DataForSEOResponse<ReviewsResult>;
export type ReviewsTaskPostResponse = DataForSEOResponse<null>;
