# Map Organiser - System Documentation v2

> **v2 Güncelleme:** 2026-04-16
> **Önceki:** system_v1.md (2026-04-11)
> **Değişiklikler:** DataForSEO entegrasyonu, Trip Planner, Public Sharing, Dark Mode, Stats Dashboard, Batch Import, Sorting, Custom Markers

---

## Genel Bakış

Map Organiser, Google Maps kayıtlı mekanlarını organize etmek, seyahat planlamak ve paylaşmak için geliştirilmiş bir PWA uygulamasıdır.

**URL:** Vercel preview (feat/dataforseo-provider branch)

---

## Tech Stack

| Katman | Teknoloji | Versiyon |
|--------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.3 |
| Runtime | Node.js | 24 LTS |
| UI | React + Tailwind CSS v4 | React 19.1 |
| Components | shadcn/ui (Base UI) | v2 |
| DB | Supabase (PostgreSQL + PostGIS) | - |
| Auth | Supabase Auth (Google OAuth) | - |
| Storage | Supabase Storage | - |
| Maps | Mapbox GL JS | 3.21 |
| Charts | Recharts | - |
| Drag & Drop | @dnd-kit | core + sortable |
| State | Zustand | - |
| Data Fetching | TanStack React Query | 5.99 |
| Theme | next-themes | 0.4.6 |
| Data Provider | DataForSEO Business Data API | v3 |
| Hosting | Vercel | - |

---

## Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────────┐
│                        Vercel                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Next.js App Router                   │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │  │
│  │  │ (app)   │ │ (auth)   │ │ /api     │ │ /shared  │ │  │
│  │  │ pages   │ │ login    │ │ routes   │ │ public   │ │  │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│            ┌─────────────┼─────────────┐                    │
│            ▼             ▼             ▼                    │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│     │ Supabase │  │ Mapbox   │  │DataForSEO│              │
│     │ DB+Auth  │  │ Maps+Dir │  │ Business │              │
│     │ Storage  │  │          │  │ Reviews  │              │
│     └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Proje Yapısı

```
src/
├── app/
│   ├── (app)/              # Auth-korumalı sayfalar
│   │   ├── map/            # Harita görünümü
│   │   ├── places/         # Mekan listesi + detay
│   │   ├── lists/          # Listeler + Trips (tab)
│   │   ├── trips/[id]/     # Trip detay (timeline + harita)
│   │   ├── stats/          # İstatistik dashboard
│   │   ├── import/         # Batch import (Zustand)
│   │   └── settings/       # Ayarlar (Categories, Tags, API, Appearance)
│   ├── (auth)/             # Login/Signup
│   ├── shared/[slug]/      # Public paylaşım sayfaları (auth gerektirmez)
│   └── api/
│       ├── places/         # CRUD, import-parse, import-batch, bulk, bulk-enrich-reviews
│       ├── trips/          # CRUD, auto-plan, day reorder, day places, swap-days
│       ├── shared/         # Create link, get content, save to account
│       ├── stats/          # Aggregate istatistikler
│       └── user/           # API keys, usage
├── components/
│   ├── map/                # MapView (forwardRef), MapContent
│   ├── places/             # PlaceCard, AddPlaceDialog, BulkActionBar, etc.
│   ├── filters/            # FilterPanel, FilterSheet, pills
│   ├── settings/           # ApiKeysManager, CostTracker
│   ├── layout/             # AppHeader, AppSidebar, MobileNav, OfflineBanner
│   └── ui/                 # shadcn/ui components
├── lib/
│   ├── dataforseo/         # Client, API types, business-info, reviews, transform, photo, adapters
│   ├── google/             # Places API, URL parser, category mapping, takeout parser, track-usage
│   ├── hooks/              # usePlaces, useFilters, useLists, useTrips, useCategories, useTags, useStats, useMapStyle, useSharedLinks
│   ├── stores/             # import-store.ts (Zustand)
│   ├── map/                # category-icons.ts (canvas marker rendering)
│   ├── trip/               # auto-plan.ts (k-means), directions.ts (Mapbox API)
│   ├── supabase/           # client.ts, server.ts (+ service role), middleware.ts
│   └── geo.ts              # Shared PostGIS point parser
└── public/
    ├── sw.js               # Service Worker
    └── icon-*.png          # PWA icons
```

---

## Environment Variables

| Değişken | Açıklama |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase proje URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (public sharing RLS bypass) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox GL + Directions API |
| `GOOGLE_PLACES_API_KEY` | Google Places (admin, opsiyonel) |
| `ENCRYPTION_SECRET` | AES-256-GCM (API key encryption) |
| `DATAFORSEO_LOGIN` | DataForSEO hesap login |
| `DATAFORSEO_PASSWORD` | DataForSEO hesap password |

---

## Database Schema

### v1 Tabloları (mevcut)
- `places` — Mekanlar (PostGIS geography, google_data JSONB)
- `categories` — 12 default kategori (renk + ikon)
- `tags` — Kullanıcı etiketleri
- `place_tags` — Junction
- `lists` — Listeler
- `list_places` — Junction + `sort_order` (F-09)
- `place_photos` — Fotoğraflar
- `profiles` — Kullanıcı profili (encrypted keys, google_places_enabled)
- `api_usage` — API maliyet takibi

### v2 Yeni Tablolar

**`trips`** — Seyahat planları
```
id, user_id, list_id, name, start_date, end_date, color, notes, created_at, updated_at
```

**`trip_days`** — Trip günleri
```
id, trip_id, day_number, date, notes, created_at
```

**`trip_day_places`** — Gün içi mekanlar (sıralı)
```
id, trip_day_id, place_id (CASCADE DELETE), sort_order, time_slot, notes, created_at
```

**`shared_links`** — Public paylaşım linkleri
```
id, user_id, resource_type (list|trip), resource_id, slug (UNIQUE), is_active, view_count, created_at
```

### v2 Kolon Eklemeleri
- `list_places.sort_order` (integer, default 0) — F-09 drag & drop

---

## Anahtar Veri Akışları

### DataForSEO Enrichment (Tekli mekan ekleme)
```
URL paste → parseMapsUrl() → extractCID
  → Google path (if enabled): searchPlace() veya getPlaceDetails()
  → DataForSEO path: fetchBusinessInfoLive() → transformBusinessInfoToPlaceData()
  → Kullanıcıya preview göster
  → Kaydet → POST /api/places
  → Background: enrich step=info (photo) + step=reviews (polling)
```

### Batch Import (Client-driven)
```
File upload → POST /import-parse → place list döner
  → Client loop (batch=3):
    → POST /import-batch (3 mekan)
    → DataForSEO enrich + insert + photo + list/tag assignment
    → Zustand store progress güncelle
  → Cancel: client döngüyü kırar
  → Background: POST /bulk-enrich-reviews (batch=5)
```

### Trip Planner
```
Create trip (tarih + listeden mekan) → trip_days oluştur
  → Auto Plan: k-means clustering → kategori sıralama → nearest-neighbor
  → GET /api/trips/[id]: days + places + Mapbox Directions API (route per day)
  → Timeline UI: drag & drop reorder, add/remove/move places, swap days
  → Map: day-colored polylines + day selector pills
```

### Public Sharing
```
Share butonu → POST /api/shared → nanoid slug
  → /shared/[slug] (public, no auth)
  → GET /api/shared/[slug] (service role, RLS bypass)
  → List: places + harita | Trip: days + places + routes
  → Login'li: "Save to my account" → copy places/trip
  → Logout: "Create your free account" CTA
```

---

## Tema Sistemi

- **Provider:** next-themes (attribute="class", defaultTheme="system")
- **CSS:** globals.css'de `:root` + `.dark` oklch variables
- **Toggle:** Header'da Sun/Moon/Monitor cycle
- **Settings:** Appearance tab (Light/Dark/System)
- **Harita:** Auto (tema takibi) veya manual (Streets/Satellite/Outdoors/Light/Dark)
- **Marker:** Dots (basit daire) veya Icons (kategori ikonlu) — localStorage
- **Persistence:** localStorage (next-themes default + map-style + marker-style)
