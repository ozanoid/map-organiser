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
  rating: number | null;
  notes: string | null;
  visit_status: VisitStatus | null;
  visited_at: string | null;
  booked_at: string | null;
  google_data: GooglePlaceData;
  source: "manual" | "import" | "link";
  created_at: string;
  updated_at: string;
  // Joined
  category?: Category;
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

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
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
}

export interface GooglePlaceData {
  types?: string[];
  photos?: string[];
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
  editorial_summary?: string;
}

export interface PlaceFilters {
  country?: string;
  city?: string;
  category_id?: string;
  tag_ids?: string[];
  list_id?: string;
  rating_min?: number;
  google_rating_min?: number;
  visit_status?: VisitStatus;
  search?: string;
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
  reviews?: GoogleReview[];
  editorialSummary?: string | null;
  priceLevel?: number | null;
}
