# Map Organiser - System Design v1

## Service Architecture

Uygulama monolitik bir Next.js App Router uygulamasidir, ancak mantiksal olarak 10 servis domaine ayrilir. Her domain bagimsiz sorumluluk alanina sahiptir.

---

## Service 1: Auth Service

### Sorumluluk
Kullanici kimlik dogrulama, oturum yonetimi, yetkilendirme.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/middleware.ts` | Route guard entry point |
| `src/lib/supabase/middleware.ts` | Session validation + cookie management |
| `src/lib/supabase/client.ts` | Browser-side Supabase client factory |
| `src/lib/supabase/server.ts` | Server-side Supabase client factory |
| `src/app/auth/callback/route.ts` | OAuth code → session exchange |
| `src/app/(auth)/login/page.tsx` | Login form (email + Google) |
| `src/app/(auth)/signup/page.tsx` | Registration form |

### Yetkilendirme Katmanlari
1. **Middleware (Route Level):** Her istek icin session kontrolu. Auth sayfalar disinda tum route'lar korunur.
2. **API (Request Level):** Her API route `supabase.auth.getUser()` ile kullaniciyi dogrular.
3. **RLS (Database Level):** Supabase RLS politikalari `auth.uid() = user_id` ile veri erisimini sinirlar.

### Oturum Yonetimi
- `@supabase/ssr` kullanir - cookie-based session
- Server component'larda `cookies()` ile okunur
- Client component'larda `createBrowserClient()` ile okunur
- Middleware her istekte session'i yeniler (cookie refresh)

### OAuth Akisi
```
Client → supabase.auth.signInWithOAuth({provider: 'google'})
  → Google consent screen
  → Redirect to Supabase callback
  → Supabase redirect to /auth/callback?code=xxx
  → exchangeCodeForSession(code) → session cookie set
  → Redirect to /map
```

### Profil Olusturma
- DB trigger: `on_auth_user_created` → `handle_new_user()` fonksiyonu
- Google metadata'dan `full_name` ve `avatar_url` cekilir
- Ardindan `on_profile_created_default_categories` trigger'i 12 default kategori olusturur

---

## Service 2: Places Service

### Sorumluluk
Mekan CRUD islemleri, filtreleme, siralama, PostGIS konum yonetimi.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/app/api/places/route.ts` | GET (list with filters) + POST (create) |
| `src/app/api/places/[id]/route.ts` | GET (detail) + PATCH (update) + DELETE |
| `src/lib/hooks/use-places.ts` | Client-side query/mutation hooks |
| `src/lib/types/index.ts` | Place, PlaceFilters, ParsedPlaceData interfaces |

### API Detaylari

#### GET /api/places
```
Query Params → Supabase Query Builder
  country    → .eq("country", value)
  city       → .eq("city", value)
  category   → .eq("category_id", value)
  status     → .eq("visit_status", value)
  rating     → .gte("rating", value)
  q          → .or("name.ilike.%q%,address.ilike.%q%,notes.ilike.%q%")

Post-Filter (JavaScript):
  google_rating → google_data.rating >= value
  tags          → place_tags junction lookup
  list          → list_places junction lookup

Transform:
  PostGIS EWKB hex → {lat, lng} via parsePostgisPoint()
```

#### POST /api/places
```
Input validation → Duplicate check (google_place_id) →
  Auto-categorize (if no category_id provided) →
  Set timestamps (visited_at, booked_at) →
  INSERT places →
  INSERT place_tags (if tag_ids) →
  INSERT list_places (if list_ids) →
  Return place with location as {lat, lng}
```

#### PATCH /api/places/[id]
```
Ownership check → Build update object →
  Visit status timestamp logic:
    - visited → set visited_at if null
    - booked → set booked_at if null
    - null/want_to_go → clear both
  Tag sync: DELETE all + INSERT new →
  List sync: DELETE all + INSERT new →
  Return updated place
```

### PostGIS EWKB Parsing
```typescript
function parseEWKB(hex: string): {lat, lng} | null {
  const buf = Buffer.from(hex, "hex");
  const le = buf[0] === 1; // little-endian flag
  const lng = le ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
  const lat = le ? buf.readDoubleLE(17) : buf.readDoubleBE(17);
  return { lat, lng };
}
```
Supabase REST API, geography kolonlarini hex-encoded EWKB olarak dondurur. `POINT(lng lat)` WKT formatini da parse ederiz ama production'da EWKB gelir.

### Client Hooks
| Hook | Type | Query Key | API |
|------|------|-----------|-----|
| `usePlaces(filters)` | Query | `["places", filters]` | GET /api/places?... |
| `useCreatePlace()` | Mutation | invalidates `["places"]` | POST /api/places |
| `useUpdateVisitStatus()` | Mutation | invalidates `["places"]` | PATCH /api/places/{id} |
| `useRefreshGoogleData()` | Mutation | invalidates `["places"]` | POST /api/places/{id}/refresh |
| `useParseLink()` | Mutation | - | POST /api/places/parse-link |

---

## Service 3: Google Integration Service

### Sorumluluk
Google Maps URL parsing, Places API entegrasyonu, yer zenginlestirme, S2 cell decode.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/lib/google/places-api.ts` | Google Places API (New) wrapper |
| `src/lib/google/parse-maps-url.ts` | URL parser (5 format destekli) |
| `src/lib/google/category-mapping.ts` | 300+ Google type → 12 kategori mapping |
| `src/lib/google/takeout-parser.ts` | CSV + GeoJSON parser |
| `src/app/api/places/parse-link/route.ts` | URL → place data API endpoint |
| `src/app/api/places/[id]/refresh-google-data/route.ts` | Google data refresh endpoint |

### URL Parsing Pipeline
```
Input URL
  ↓
Short link? (goo.gl, maps.app.goo.gl)
  → YES → resolveUrl() (HEAD + follow redirect)
  ↓
Extract ChIJ Place ID? (!1sChIJ... or place_id=ChIJ...)
  → YES → type: "place_id" → getPlaceDetails(placeId)
  ↓
Extract FTid? (!1s0x...:0x...)
  → YES → ftidToCoordinates() via S2 decode
         → type: "search" with coords + query
  ↓
Extract CID? (?cid=12345)
  → YES → type: "cid" + coords
  ↓
Extract search query? (/maps/place/Name or /maps/search/Query)
  → YES → type: "search" + coords (if available)
  ↓
Extract coordinates? (@lat,lng or !3d...!4d...)
  → YES → type: "coordinates"
  ↓
type: "unknown"
```

### S2 Cell Decode (FTid)
FTid format: `0x48761da571b3e74b:0xdf82213aa7f76779`
- Birinci hex kismi: S2 Cell ID (konum kodlar)
- `s2-geometry` npm paketi ile decode → yaklasik lat/lng
- Hassasiyet: ~3km (sehir icindeki dogru subeysi bulmak icin yeterli)
- Kullanim: Text search'te locationBias olarak

### Google Places API (New)
- **Base URL:** `https://places.googleapis.com/v1`
- **Auth:** `X-Goog-Api-Key` header (server-only, asla client'a gitmez)

### Maliyet Tierleri

| Tier | Field Mask | Fiyat/1K | Kullanim |
|------|-----------|----------|----------|
| **Essentials** | id, displayName, formattedAddress, addressComponents, location, types | $5 | - |
| **Pro** (DEFAULT) | + rating, userRatingCount, openingHours, websiteUri, phone, photos (ref), priceLevel, googleMapsUri | **$17** | Mekan ekleme, import |
| **Enterprise** | + reviews | **$20** | Sadece refresh butonu ile |
| **Photos** | Her foto media indirme | **$7** | Mekan basina 1 foto, Supabase Storage'a kaydedilir |

**Onemli:** `editorialSummary` sistemden tamamen kaldirildi (Enterprise+Atmosphere $25/1K tier tetikliyordu).

**Ucretsiz kullanim:** Her SKU icin ayda 1,000 istek ucretsiz.

### Foto Depolama Akisi
```
Google Places API → photoRef (referans, ucretsiz) →
  GET /places/{ref}/media ($7/1K) → binary image →
  Supabase Storage upload (place-photos bucket) →
  Public URL → google_data.photo_storage_url olarak kaydedilir
```
Her mekan icin sadece 1 foto indirilir. Browser'da gosterildiginde Supabase'den servis edilir (Google'a istek gitmez).

### Fonksiyonlar
| Fonksiyon | Input | Output | Tier | Aciklama |
|-----------|-------|--------|------|----------|
| `getPlaceDetails(placeId)` | ChIJ... string | ParsedPlaceData | Pro ($17/1K) | Tek yer detayi (reviews haric) |
| `searchPlace(query, lat?, lng?)` | Text + optional coords | ParsedPlaceData | Pro ($17/1K) | Metin aramasI, 5km radius bias |
| `getPlaceReviews(placeId)` | ChIJ... string | GoogleReview[] | Enterprise ($20/1K) | Sadece yorumlar (on-demand) |
| `downloadAndStorePhoto(ref, placeId, userId)` | Photo ref + IDs | Storage URL | Photos ($7/1K) | Foto indir → Supabase Storage |
| `parseMapsUrl(rawUrl)` | Any Google Maps URL | ParsedUrl | Ucretsiz | URL → yapilandirilmis veri |
| `resolveUrl(url)` | Short link URL | Full URL | Ucretsiz | Redirect takibi |
| `ftidToCoordinates(ftid)` | 0x...:0x... | {lat, lng} | Ucretsiz | S2 cell decode |
| `resolveCategoryName(types, name?)` | string[] | Category name | Ucretsiz | Type → kategori eslesmesi |
| `resolveCategoryId(types, cats, name?)` | types + user cats | UUID | Ucretsiz | Kategori ID resolve |
| `parseTakeoutCsv(text)` | CSV text | TakeoutPlace[] | Ucretsiz | CSV parser |
| `parseTakeoutGeoJson(json)` | GeoJSON object | TakeoutPlace[] | Ucretsiz | GeoJSON parser |

### Maliyet Ornekleri
| Islem | API Cagrilari | Maliyet |
|-------|--------------|---------|
| 1 mekan ekleme (link) | 1 Text Search + 1 Photo | $0.024 |
| 1 mekan refresh (reviews) | 1 Place Details + 1 Reviews + 1 Photo | $0.044 |
| 100 mekan CSV import | 100 Text Search + 100 Photo | $2.40 |
| Aylik 1000 istek (her SKU) | - | $0 (ucretsiz) |

### Auto-Kategorilendirme
300+ Google Place type → 12 kategori mapping. Oncelik sirasi:
1. Isim heuristic: "beach", "plaj", "sahil" → Beach
2. `*_restaurant` pattern → Restaurant
3. Direkt esleme tablosu (cafe→Cafe, pub→Bar & Nightlife, vb.)
4. Fallback → "Other"

---

## Service 4: Category Service

### Sorumluluk
Kategori CRUD, default kategori yonetimi, renk ve icon atama.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/lib/hooks/use-categories.ts` | Client CRUD hooks |
| `src/components/filters/category-filter.tsx` | Toggle pill UI |
| `src/components/places/inline-category-creator.tsx` | Inline popover creator |
| `src/app/(app)/settings/page.tsx` | Full CRUD management |

### Hooks
| Hook | Type | Aciklama |
|------|------|----------|
| `useCategories()` | Query ["categories"] | Tum kategoriler, sort_order sirali |
| `useCreateCategory()` | Mutation | name + color + icon ile olustur |
| `useDeleteCategory()` | Mutation | Siler, places'in category_id'si SET NULL olur |

### Default Kategori Sistemi
- `is_default: true` flag ile isaretlenir
- Silme islemi UI'da engellenir
- Kullanici yeni kategoriler ekleyebilir
- Auto-kategorilendirme sadece default isimlerle eslesir

---

## Service 5: Tag Service

### Sorumluluk
Etiket CRUD, yer-etiket iliskisi yonetimi, filtreleme.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/lib/hooks/use-tags.ts` | Client CRUD + toggle hooks |
| `src/components/filters/tag-filter.tsx` | Multi-select pill UI |
| `src/components/places/inline-tag-input.tsx` | Combobox + inline create |
| `src/app/(app)/settings/page.tsx` | Tag management tab |

### Hooks
| Hook | Type | Aciklama |
|------|------|----------|
| `useTags()` | Query ["tags"] | Tum etiketler, isme gore sirali |
| `useCreateTag()` | Mutation | Isimden olustur |
| `useDeleteTag()` | Mutation | Siler + places invalidate |
| `usePlaceTags(placeId)` | Query ["place-tags", id] | Bir yerin etiketleri |
| `useTogglePlaceTag()` | Mutation | Etiket ekle/cikar (PATCH) |

### Tag ↔ Place Iliskisi
- Many-to-many: `place_tags` junction tablosu
- PATCH /api/places/{id} ile `tag_ids[]` gonderildiginde: DELETE all + INSERT new (full sync)
- Bulk tag ekleme: POST /api/places/bulk ile `action: "add_tags"` (upsert, duplicate skip)

---

## Service 6: List Service

### Sorumluluk
Kullanici listesi CRUD, yer-liste iliskisi, place count.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/lib/hooks/use-lists.ts` | Client CRUD hooks |
| `src/components/filters/list-filter.tsx` | Native select dropdown |
| `src/components/places/inline-list-creator.tsx` | Inline popover creator |
| `src/app/(app)/lists/page.tsx` | Grid gorunumu + olusturma dialog |
| `src/app/(app)/lists/[id]/page.tsx` | Liste detayi + harita gorunumu |

### Hooks
| Hook | Type | Aciklama |
|------|------|----------|
| `useLists()` | Query ["lists"] | Tum listeler + place_count |
| `useCreateList()` | Mutation | name + description + color |
| `useDeleteList()` | Mutation | Liste sil (junction records cascade) |
| `useAddToList()` | Mutation | list_places insert |
| `useRemoveFromList()` | Mutation | list_places delete |
| `usePlaceLists(placeId)` | Query ["place-lists", id] | Bir yerin listeleri |

---

## Service 7: Map Service

### Sorumluluk
Mapbox harita gosterimi, marker yonetimi, clustering, popup'lar, detay paneli.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/components/map/map-view.tsx` | Mapbox GL JS entegrasyonu |
| `src/app/(app)/map/page.tsx` | Map page + filter sidebar + detail panel |

### Mapbox Konfigurasyonu
```
Style: mapbox://styles/mapbox/light-v11
Default Center: [29.0, 41.0] (Istanbul)
Default Zoom: 5
Clustering: maxZoom 14, radius 50
Attribution: disabled
Controls: NavigationControl (no compass), GeolocateControl
```

### GeoJSON Feature Properties
```typescript
{
  id: string          // Place UUID
  name: string        // Place name
  address: string     // Full address
  rating: number      // User rating (1-5)
  categoryColor: string  // Hex color for marker
  categoryIcon: string   // Lucide icon name
  visitStatus: string    // want_to_go/booked/visited/favorite
  googleUrl: string      // Google Maps URL
}
```

### Visit Status Marker Stilleri
| Status | Stroke Color | Stroke Width |
|--------|-------------|--------------|
| visited | #22C55E (green) | 3px |
| favorite | #EF4444 (red) | 3px |
| booked | #3B82F6 (blue) | 3px |
| want_to_go | #F59E0B (amber) | 2.5px |
| (none) | #FFFFFF (white) | 2px |

### Popup → Detail Panel Akisi
1. Marker click → Mapbox popup (name, address, rating, Maps link, "View details →")
2. "View details →" click → `onPlaceClick(place)` callback (uses refs for stability)
3. Map page: `setSelectedPlace(place)` → fetch full details
4. Right-side panel slides in (w-96 on desktop, full-width on mobile)
5. Panel shows: photo, address, badges, visit status, rating, hours, reviews, notes, actions
6. "Full details" button → navigates to /places/{id}

### Stable Event Handler Pattern
```typescript
// Problem: Mapbox event handlers capture stale closures
// Solution: Use refs that update on every render
const placesRef = useRef(places);
const onPlaceClickRef = useRef(onPlaceClick);
placesRef.current = places;
onPlaceClickRef.current = onPlaceClick;

// Event handler always reads current values
map.on("click", "unclustered-point", (e) => {
  const place = placesRef.current.find(p => p.id === props.id);
  if (place) onPlaceClickRef.current?.(place);
});
```

---

## Service 8: Import Service

### Sorumluluk
Google Takeout dosyalarini (CSV/GeoJSON) import etme, zenginlestirme, toplu kategorilendirme.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/app/api/places/import/route.ts` | Import API endpoint |
| `src/lib/google/takeout-parser.ts` | CSV + GeoJSON parsers |
| `src/app/(app)/import/page.tsx` | Import UI (drag & drop + results) |

### Import Akisi
```
1. Dosya yukleme (CSV veya GeoJSON)
2. Parse: parseTakeoutCsv() veya parseTakeoutGeoJson()
3. Her yer icin:
   a. Google Maps URL varsa → parseMapsUrl() ile resolve
   b. getPlaceDetails() veya searchPlace() ile zenginlestir (Pro tier $17/1K)
   c. resolveCategoryId() ile auto-kategorilendirme
   d. Duplikat kontrolu (google_place_id)
   e. INSERT → places tablosu
   f. photoRef varsa → downloadAndStorePhoto() → Supabase Storage ($7/1K)
   g. google_data.photo_storage_url guncelle
   h. 200ms rate limit delay
4. Sonuc: {imported, failed, enriched, total, skipped[]}
```

**Not:** Import sirasinda reviews ve editorialSummary cekilmez (maliyet optimizasyonu).

### Photo Migration Endpoint
`POST /api/places/migrate-photos` - Tek seferlik migration.
- Mevcut Google foto URL'lerini Supabase Storage'a indirir
- Sadece `google_data.photos` olan ama `photo_storage_url` olmayan mekanlari isler
- Sonuc: `{total, migrated, failed, skipped}`

### CSV Format (Google Takeout)
```
Title,Note,URL,Tags,Comment
Los Compadres,,https://www.google.com/maps/place/Los+Compadres/data=...,,
```

### Rate Limiting
- Google Places API: 200ms araliklarla istek (saniyede max 5)
- Buyuk import'larda (100+ yer) toplam sure: ~20-40 saniye
- Vercel function timeout: 300s (yeterli ~1500 yer icin)

---

## Service 9: Bulk Operations Service

### Sorumluluk
Coklu mekan uzerinde toplu islemler.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/app/api/places/bulk/route.ts` | Bulk action API endpoint |
| `src/components/places/bulk-action-bar.tsx` | Floating toolbar UI |
| `src/app/(app)/places/page.tsx` | Selection state + checkbox UI |

### API: POST /api/places/bulk
```typescript
Request: {
  action: "update_category" | "add_tags" | "add_to_list" | "update_status" | "delete",
  place_ids: string[],
  category_id?: string,
  tag_ids?: string[],
  list_id?: string,
  visit_status?: string
}
Response: { success: true, affected: number }
```

### Islem Detaylari
| Action | SQL Operation | Ek Mantik |
|--------|--------------|-----------|
| update_category | UPDATE places SET category_id | Tek seferde tum ID'ler |
| add_tags | UPSERT place_tags | ignoreDuplicates ile cakisma onleme |
| add_to_list | UPSERT list_places | ignoreDuplicates |
| update_status | UPDATE places SET visit_status | visited_at/booked_at timestamp mantigi |
| delete | DELETE places | Cascade ile junction tablolar temizlenir |

### Guvenlik
- Tum place_ids kullaniciya ait mi dogrulama
- Gecersiz ID'ler sessizce filtrelenir
- Islem sayisi response'ta bildirilir

### Selection UI
- `Set<string>` ile selectedIds state
- Her PlaceCard'da checkbox overlay (sol ust kose)
- "Select All" / "Deselect All" toggle butonu
- Secili card: `ring-2 ring-emerald-500` gorsel vurgu
- BulkActionBar: `fixed bottom-14 lg:bottom-0` pozisyonda

---

## Service 10: Filter Service

### Sorumluluk
URL-tabanli filtre state yonetimi, filtre UI componentleri.

### Dosyalar
| Dosya | Rol |
|-------|-----|
| `src/lib/hooks/use-filters.ts` | URL ↔ filter state cevirmeni |
| `src/components/filters/filter-panel.tsx` | Desktop sidebar filtre UI |
| `src/components/filters/filter-sheet.tsx` | Mobile bottom sheet filtre UI |
| `src/components/filters/category-filter.tsx` | Kategori toggle pill'leri |
| `src/components/filters/country-city-filter.tsx` | Ulke/sehir native select |
| `src/components/filters/tag-filter.tsx` | Tag multi-select pill'leri |
| `src/components/filters/list-filter.tsx` | Liste native select |
| `src/components/filters/visit-status-filter.tsx` | Status toggle pill'leri |

### PlaceFilters Interface
```typescript
interface PlaceFilters {
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
```

### URL Param Mapping
| Filter Key | URL Param | Ornek |
|-----------|-----------|-------|
| country | country | ?country=Turkey |
| city | city | ?city=Istanbul |
| category_id | category | ?category=uuid |
| tag_ids | tags | ?tags=uuid1,uuid2 |
| list_id | list | ?list=uuid |
| rating_min | rating | ?rating=4 |
| google_rating_min | google_rating | ?google_rating=4 |
| visit_status | status | ?status=visited |
| search | q | ?q=coffee |

### Filtre Onceligi (Performance)
1. **DB Level (hizli):** country, city, category_id, visit_status, rating_min, search (name/address/notes)
2. **JS Post-Filter (yavas ama gerekli):** google_rating_min (JSONB), tag_ids (junction), list_id (junction)

### Native Select Karari
Base UI Select componentleri projede guvenilir calismadigindan (selection bozuklugu, UUID gosterme, "All" geri secilememe), tum dropdown filtreler native `<select>` HTML elementi kullanir. Bu yaklasim:
- Tum tarayicilarda calisiyor
- Erisilebilirlik (a11y) dahili
- Mobilde native picker aciliyor
- Stillendirilmis (appearance-none + custom chevron icon)

---

## Cross-Cutting Concerns

### Error Handling
- API route'lari: try/catch + console.error + JSON error response
- Client hooks: TanStack Query `onError` callback + toast notification
- Google API hatalari: null return + fallback davranisi (kategorisiz kaydet)

### Caching
- React Query: 60s stale time, no refetch on window focus
- Google Places API: `next.revalidate: 86400` (24 saat HTTP cache)
- Mapbox tiles: browser cache (Mapbox CDN)

### Performance Considerations
- PostGIS GIST index → konum sorgulari O(log n)
- Clustering → buyuk veri setlerinde harita performansi
- Junction tablo filtreleme → O(n) JS post-filter (gelecekte DB function ile optimize edilebilir)
- CSV import: sequential (rate limit), parallelizable with queue system

### Security
- GOOGLE_PLACES_API_KEY asla client'a gitmez (server-only env)
- Supabase anon key RLS ile sinirli (kullanici sadece kendi verisini gorur)
- All API routes validate auth before any operation
- Bulk operations verify ownership of all place_ids
