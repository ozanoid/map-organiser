# Map Organiser - System Documentation v1

## Overview

Map Organiser, kullanicilarin Google Maps'te kaydettikleri mekanlari organize etmelerini saglayan bir web uygulamasidir. Kullanicilar Google Maps linklerini yapistirarak veya CSV/GeoJSON import ederek mekan ekler; kategoriler, etiketler, listeler ve ziyaret durumuyla organize eder; harita ve liste gorunumlerinde filtreler.

**Production URL:** https://map-organiser.vercel.app
**Repository:** https://github.com/ozanoid/map-organiser
**Supabase Project:** hukppmaevcapvbrvxtph (eu-central-1)

---

## Tech Stack

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Framework | Next.js (App Router) | 16.2.3 |
| Runtime | Node.js | 22.x |
| Language | TypeScript | 5.x |
| UI | Tailwind CSS + shadcn/ui | v4 / Base UI |
| Icons | Lucide React | latest |
| Toast | Sonner | latest |
| State | TanStack React Query | 5.97 |
| Auth | Supabase Auth (@supabase/ssr) | 0.10.2 |
| Database | Supabase PostgreSQL + PostGIS | PG 17.6 |
| Storage | Supabase Storage | - |
| Maps | Mapbox GL JS | 3.21 |
| S2 Decode | s2-geometry | 1.2.10 |
| Deploy | Vercel | - |
| PWA | manifest.ts + Service Worker | - |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        VERCEL                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 Next.js App Router                       │ │
│  │                                                          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │ │
│  │  │  Pages   │  │   API    │  │     Middleware          │ │ │
│  │  │ (React)  │  │  Routes  │  │  (Auth + Session)      │ │ │
│  │  └────┬─────┘  └────┬─────┘  └────────────────────────┘ │ │
│  │       │              │                                    │ │
│  │       │   ┌──────────┴──────────────────────┐            │ │
│  │       │   │        Server-Side Only          │            │ │
│  │       │   │  ┌──────────┐ ┌───────────────┐  │            │ │
│  │       │   │  │ Supabase │ │ Google Places │  │            │ │
│  │       │   │  │  Client  │ │   API v1      │  │            │ │
│  │       │   │  └─────┬────┘ └───────┬───────┘  │            │ │
│  │       │   └────────┼──────────────┼──────────┘            │ │
│  └───────┼────────────┼──────────────┼──────────────────────┘ │
└──────────┼────────────┼──────────────┼──────────────────────┘
           │            │              │
    ┌──────┴──────┐  ┌──┴───┐  ┌──────┴──────┐
    │   Mapbox    │  │Supa- │  │   Google    │
    │   Tile      │  │base  │  │   Places    │
    │   Server    │  │Cloud │  │   API       │
    └─────────────┘  └──────┘  └─────────────┘
```

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root: Inter font, QueryProvider, Toaster, SW register, Apple PWA meta
│   ├── page.tsx                # / → redirect to /map or /login
│   ├── manifest.ts             # PWA manifest + Share Target
│   ├── middleware.ts           # Auth guard (all routes)
│   ├── auth/callback/route.ts  # OAuth code exchange
│   ├── (auth)/                 # Public auth pages
│   │   ├── layout.tsx          # Centered container
│   │   ├── login/page.tsx      # Email + Google login
│   │   └── signup/page.tsx     # Registration
│   ├── (app)/                  # Protected app pages
│   │   ├── layout.tsx          # Sidebar + Header + MobileNav + OfflineBanner
│   │   ├── map/page.tsx        # Server component: mapbox token fetch
│   │   ├── places/page.tsx     # Card grid + filters + bulk actions
│   │   ├── places/[id]/page.tsx# Place detail
│   │   ├── lists/page.tsx      # List management
│   │   ├── lists/[id]/page.tsx # List detail + map
│   │   ├── import/page.tsx     # CSV/GeoJSON import
│   │   ├── settings/page.tsx   # Category + tag CRUD + API & Usage tab
│   │   └── offline/page.tsx   # PWA offline fallback page
│   └── api/
│       ├── places/route.ts          # GET (list) + POST (create)
│       ├── places/[id]/route.ts     # GET + PATCH + DELETE
│       ├── places/bulk/route.ts     # POST bulk actions
│       ├── places/import/route.ts   # POST file import
│       ├── places/parse-link/route.ts # POST URL → place data
│       ├── places/[id]/refresh-google-data/route.ts
│       ├── user/api-keys/route.ts   # GET (masked) + PUT (encrypted save)
│       ├── user/usage/route.ts      # GET monthly usage stats
│       └── share-target/route.ts    # PWA share receiver
├── components/
│   ├── ui/                     # shadcn/ui primitives (~20 files)
│   ├── layout/                 # App shell (sidebar, header, mobile nav, offline banner)
│   ├── map/                    # MapView + MapContent (Mapbox GL JS)
│   ├── filters/                # Filter components (9 files)
│   └── places/                 # Place components (7 files)
├── lib/
│   ├── types/index.ts          # All TypeScript interfaces
│   ├── utils.ts                # cn() utility
│   ├── providers.tsx           # QueryClientProvider
│   ├── supabase/               # Supabase clients (browser, server, middleware)
│   ├── hooks/                  # React Query hooks + utilities (6 files)
│   └── google/                 # Google API integration (6 files)
├── sw-register.tsx             # Service worker registration (client component)
└── middleware.ts               # Next.js middleware entry

public/
├── sw.js                       # Service worker (offline cache, stale-while-revalidate)
├── icon-192.png                # PWA icon 192x192
└── icon-512.png                # PWA icon 512x512
```

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon JWT key |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Public | Mapbox GL access token (admin fallback) |
| `GOOGLE_PLACES_API_KEY` | Server-only | Google Places API key (admin fallback) |
| `ENCRYPTION_SECRET` | Server-only | AES-256-GCM key derivation secret (zorunlu) |

---

## Database Schema

### Tables

#### `places`
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK → auth.users |
| name | text | NO | - | Place name |
| address | text | YES | - | Full address |
| country | text | YES | - | Country name |
| city | text | YES | - | City name |
| location | geography(point,4326) | NO | - | PostGIS point (SRID 4326) |
| category_id | uuid | YES | - | FK → categories (ON DELETE SET NULL) |
| rating | smallint | YES | - | User's rating 1-5 |
| notes | text | YES | - | User notes |
| visit_status | text | YES | - | want_to_go/booked/visited/favorite |
| visited_at | timestamptz | YES | - | When marked visited |
| booked_at | timestamptz | YES | - | When marked booked |
| google_place_id | text | YES | - | Google Place ID (ChIJ format) |
| google_data | jsonb | NO | '{}' | Cached Google data |
| source | text | NO | 'manual' | manual/import/link |
| created_at | timestamptz | NO | now() | - |
| updated_at | timestamptz | NO | now() | - |

**Indexes:** user_id, location (GIST), category_id, (user_id, country, city), (user_id, google_place_id), (user_id, visit_status)

#### `google_data` JSONB Structure
```json
{
  "types": ["restaurant", "food"],
  "photo_storage_url": "https://[project].supabase.co/storage/v1/object/public/place-photos/[user_id]/[place_id].jpg",
  "rating": 4.5,
  "user_ratings_total": 1234,
  "opening_hours": {
    "weekday_text": ["Monday: 10:00 AM - 11:00 PM", ...],
    "open_now": true
  },
  "website": "https://example.com",
  "phone": "+44 20 1234 5678",
  "price_level": 2,
  "url": "https://www.google.com/maps/place/...",
  "reviews": [...]
}
```

**Onemli notlar:**
- `photo_storage_url`: Fotograf Google'dan indirilip Supabase Storage'a kaydedilir. Google URL'leri tutulmaz.
- `reviews`: Varsayilan olarak bos. Sadece kullanici "Refresh" butonuna tikladiginda cekilir (Enterprise tier, $20/1K).
- `editorial_summary`: Sistemden tamamen kaldirildi (Enterprise+Atmosphere tier $25/1K tetikliyordu).
- `photos` (eski Google URL dizisi): Deprecated. Yeni kayitlarda tutulmaz. `photo_storage_url` kullanilir.

#### `categories`
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | uuid | gen_random_uuid() | Primary key |
| user_id | uuid | - | FK → auth.users |
| name | text | - | Category name |
| color | text | '#059669' | Hex color for markers |
| icon | text | 'map-pin' | Lucide icon name |
| sort_order | int | 0 | Display order |
| is_default | boolean | false | System default flag |
| created_at | timestamptz | now() | - |

**Unique:** (user_id, name)

**12 Default Categories** (created via trigger on signup):
| # | Name | Color | Icon |
|---|------|-------|------|
| 0 | Restaurant | #EF4444 | utensils |
| 1 | Cafe | #F97316 | coffee |
| 2 | Bar & Nightlife | #8B5CF6 | wine |
| 3 | Hotel & Accommodation | #3B82F6 | bed-double |
| 4 | Shopping | #EC4899 | shopping-bag |
| 5 | Museum & Culture | #6366F1 | landmark |
| 6 | Park & Nature | #22C55E | trees |
| 7 | Beach | #06B6D4 | umbrella |
| 8 | Gym & Sports | #F59E0B | dumbbell |
| 9 | Health & Medical | #14B8A6 | heart-pulse |
| 10 | Entertainment | #A855F7 | ticket |
| 11 | Other | #6B7280 | map-pin |

#### `tags`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK → auth.users |
| name | text | Tag name |
| color | text (nullable) | Optional hex color |
| created_at | timestamptz | - |

**Unique:** (user_id, name)

#### `place_tags` (Junction)
| Column | Type |
|--------|------|
| place_id | uuid FK → places (CASCADE) |
| tag_id | uuid FK → tags (CASCADE) |
**PK:** (place_id, tag_id)

#### `lists`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK → auth.users |
| name | text | List name |
| description | text (nullable) | - |
| color | text | '#059669' |
| created_at | timestamptz | - |
| updated_at | timestamptz | - |

#### `list_places` (Junction)
| Column | Type |
|--------|------|
| list_id | uuid FK → lists (CASCADE) |
| place_id | uuid FK → places (CASCADE) |
| sort_order | int (default 0) |
| added_at | timestamptz |
**PK:** (list_id, place_id)

#### `place_photos`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| place_id | uuid FK → places (CASCADE) | - |
| storage_path | text | Supabase Storage path |
| caption | text (nullable) | - |
| created_at | timestamptz | - |

#### `profiles`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK + FK → auth.users (CASCADE) |
| full_name | text | From Google or signup |
| avatar_url | text | From Google OAuth |
| is_admin | boolean | Admin flag (env var fallback for API keys) |
| google_api_key_enc | text | AES-256-GCM encrypted Google API key |
| mapbox_token_enc | text | AES-256-GCM encrypted Mapbox token |
| created_at | timestamptz | - |
| updated_at | timestamptz | - |

#### `api_usage`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK → auth.users |
| sku | text | SKU type (text_search_pro, place_details_pro, etc.) |
| count | integer | Daily request count |
| created_at | timestamptz | Day of usage |

**RPC:** `increment_api_usage(p_user_id, p_sku, p_cost)` → upsert daily counter

**Trigger:** `on_auth_user_created` → `handle_new_user()` → creates profile
**Trigger:** `on_profile_created_default_categories` → `create_default_categories()` → creates 12 categories

### RLS Policies
Tum tablolarda Row Level Security aktif. Her tablo icin:
- `SELECT/INSERT/UPDATE/DELETE` → `(select auth.uid()) = user_id`
- Junction tablolar (place_tags, list_places) → parent tablo uzerinden user_id kontrolu

### Storage
- **Bucket:** `place-photos` (private, 5MB max, image/* only)
- RLS: user_id folder bazli erisim

---

## Auth Flow

```
1. User navigates to any page
2. middleware.ts → updateSession()
3. supabase.auth.getUser() checks session cookie
4. If no session → redirect to /login
5. If session on auth page → redirect to /map
6. Login: signInWithPassword() or signInWithOAuth({provider: 'google'})
7. Google OAuth: redirect to Google → callback to /auth/callback
8. /auth/callback: exchangeCodeForSession(code) → set cookie → redirect /map
9. Signup: signUp() → if no email confirmation → auto-login → redirect /map
```

---

## Key Data Flows

### Add Place via Link
```
User pastes Google Maps URL
    → POST /api/places/parse-link {url}
    → getUserApiKeys(userId) → resolve per-user or admin API key
    → parseMapsUrl(url)
        → resolveShortLink (if goo.gl)
        → extractChIJPlaceId / extractFtid / extractCoordinates
        → S2 cell decode (if FTid)
    → getPlaceDetails(placeId, apiKey, userId) or searchPlace(query, apiKey, userId, lat, lng)
    → trackUsage(userId, sku) (fire-and-forget)
    → Return ParsedPlaceData (name, address, photos, reviews, etc.)
    → Client shows preview
    → User selects category, tags, lists, status
    → POST /api/places {name, lat, lng, category_id, ...}
    → Auto-categorize if no category (resolveCategoryId)
    → Insert places + place_tags + list_places
    → Return Place
    → invalidateQueries(["places"]) → map/list re-render
```

### Filter Flow
```
User clicks filter pill/dropdown in UI
    → setFilters({category_ids: ["xxx", "yyy"]})
    → [INSTANT] local state updates → usePlaces(filters) re-queries
    → [300ms DEBOUNCE] router.push("/map?category=xxx,yyy") (URL sync)
    → GET /api/places?category=xxx,yyy
    → Supabase query with .in("category_id", [xxx, yyy])
    → Post-filter for JSONB/junction (google_rating, tags, lists)
    → Transform PostGIS → {lat, lng}
    → Return Place[]
    → MapView/PlaceCard re-render

Back/Forward button → URL changes → useEffect → local state syncs
Page refresh → URL'den initial state okunur
```

### CSV Import Flow
```
User uploads .csv file
    → POST /api/places/import (FormData)
    → getUserApiKeys(userId) → resolve API key
    → parseTakeoutCsv(text)
    → For each place:
        → parseMapsUrl(googleMapsUrl) (if googleApiKey exists)
        → getPlaceDetails(id, apiKey, userId) or searchPlace(q, apiKey, userId)
        → trackUsage(userId, sku)
        → resolveCategoryId(types, categories, name)
        → Check duplicate by google_place_id
        → Insert place
        → 200ms delay (rate limit)
    → Return {imported, failed, enriched, total, skipped[], enrichmentSkipped}
```
