# Map Organiser - System Design v2

> **v2 Güncelleme:** 2026-04-16
> **Önceki:** system-design_v1.md (2026-04-11)
> **Yeni servisler:** DataForSEO (#3b), Sort (#10b), Trip Planner (#11), Sharing (#12), Stats (#13), Theme (#14), Batch Import (#8b)

---

## Servis Mimarisi (14 Servis)

```
┌─────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐
│ 1. Auth      │  │ 2. Places  │  │ 3a. Google   │  │ 3b. DataFor  │
│              │  │            │  │ Integration  │  │ SEO          │
└──────┬───────┘  └──────┬─────┘  └──────┬───────┘  └──────┬───────┘
       │                 │               │                  │
┌──────┴───────┐  ┌──────┴─────┐  ┌──────┴───────┐  ┌──────┴───────┐
│ 4. Category  │  │ 5. Tag     │  │ 6. List      │  │ 7. Map       │
└──────────────┘  └────────────┘  └──────────────┘  └──────────────┘
       │                 │               │                  │
┌──────┴───────┐  ┌──────┴─────┐  ┌──────┴───────┐  ┌──────┴───────┐
│ 8. Import    │  │ 9. Bulk    │  │ 10. Filter   │  │ 11. Trip     │
│ (batch)      │  │ Operations │  │ + Sort       │  │ Planner      │
└──────────────┘  └────────────┘  └──────────────┘  └──────────────┘
       │                 │               │                  │
┌──────┴───────┐  ┌──────┴─────┐  ┌──────┴───────┐
│ 12. Sharing  │  │ 13. Stats  │  │ 14. Theme    │
└──────────────┘  └────────────┘  └──────────────┘
```

---

## v1 Servisleri (1-10) — Değişiklik Özeti

v1 servislerinin detayları `system-design_v1.md`'de mevcut. Burada sadece v2'de yapılan değişiklikler belgelenir.

### Service 3a: Google Integration — Güncelleme
- `googlePlacesEnabled` flag ile kullanıcı kontrolü (profiles tablosu)
- Google path sadece flag aktif + API key varsa çalışır
- Fallback: DataForSEO path

### Service 6: List Service — Güncelleme
- `list_places.sort_order` kolonu eklendi
- `PATCH /api/lists/[id]/reorder` endpoint: sıralı place_ids → sort_order güncelle
- `useReorderListPlaces()` hook: optimistic DnD update
- Liste detay sayfası: @dnd-kit sortable + GripVertical handle
- GET /api/places list filtresi artık sort_order'a göre sıralar

### Service 7: Map Service — Güncelleme
- **Custom markers:** Canvas hybrid — Lucide SVG → canvas → `map.addImage()` → symbol layer
- **Marker style preference:** dots (circle layer) vs icons (symbol layer) — localStorage
- **Viewport place count:** `map.getBounds()` ile visible places → clickable dropdown list
- **Route lines:** `routeLines` prop → Mapbox line layer (trip polylines)
- **Theme-aware:** mapStyle prop, style switch + layer re-apply, dark popup colors
- **fadeDuration: 0** — cluster count text anında kaybolur
- **fitBounds:** Sadece ilk yüklemede, filtre değişimlerinde kamera sabit

### Service 8: Import Service — Büyük Değişiklik
- **Eski:** Tek long-running request + NDJSON streaming (Vercel'de çalışmıyor)
- **Yeni:** Client-driven batch yaklaşımı:
  1. `POST /import-parse` — dosya parse, place list döner (<1sn)
  2. `POST /import-batch` — 3 mekan enrich + insert (~15-20sn)
  3. Client Zustand store ile döngü yönetimi
- **DataForSEO:** Tüm bulk import DataForSEO üzerinden (Google API kullanılmaz)
- **Import options:** visit_status, list_ids, tag_ids pre-import seçimi
- **Cancel:** Client döngüyü kırar (batch arası kontrol)
- **Background reviews:** `/bulk-enrich-reviews` batch=5, depth=50

### Service 9: Bulk Operations — Güncelleme
- `check_trips` action eklendi: silmeden önce trip referanslarını sorgular
- Delete confirm'de trip uyarısı gösterilir
- Delete sonrası `["trips"]` + `["trip"]` cache invalidation

### Service 10: Filter + Sort Service — Güncelleme
- `PlaceFilters.sort` eklendi
- 6 sort seçeneği: newest, oldest, name_asc, name_desc, rating_desc, google_rating_desc
- API: dinamik `sortConfig` map → Supabase `.order()`
- `google_rating_desc`: post-query JS sort (JSONB)
- UI: Search satırında sort `<select>` + FilterPanel/FilterSheet'te "Sort by"

---

## v2 Yeni Servisler (11-14)

### Service 11: Trip Planner

**Dosyalar:**
- `src/app/api/trips/` — CRUD + auto-plan + day reorder + day places + swap-days
- `src/lib/trip/auto-plan.ts` — K-means clustering algoritması
- `src/lib/trip/directions.ts` — Mapbox Directions API wrapper
- `src/lib/hooks/use-trips.ts` — 8 hook
- `src/app/(app)/trips/[id]/page.tsx` — Timeline + Map view

**Auto-Plan Algoritması:**
```
1. K-Means++ Clustering (k = gün sayısı)
   - Koordinat bazlı, 8 iterasyon
   - En uzak noktalar init (k-means++)

2. Kategori Sıralama (gün içi)
   - Cafe(0) → Park(1) → Müze(2) → Shopping(2) → Restaurant(4) → Bar(5)

3. Nearest-Neighbor Rotası
   - Greedy: her adımda en yakın ziyaret edilmemiş mekanı seç
```

**Directions API:**
- `GET https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}`
- Response: distance (km), duration (min), geometry (GeoJSON LineString), legs
- Trip detail GET'te her gün için otomatik çağrılır
- Free tier: 100K request/ay

**Trip Management:**
- Mekan silme: X butonu + confirm → DELETE trip_day_places
- Mekan ekleme: "+ Add place" → dialog (tüm mekanlardan search)
- Günler arası taşıma: "Move to Day X" dropdown
- Gün sırası: ↑↓ ok butonları (swap day_number + date)
- Gün içi sıralama: drag & drop (@dnd-kit)

**Navigasyon:** Lists sayfasında "My Lists" / "My Trips" tab

---

### Service 12: Public Sharing

**Dosyalar:**
- `src/app/api/shared/` — create, get (service role), save-to-account
- `src/app/shared/[slug]/page.tsx` — Public sayfa
- `src/lib/hooks/use-shared-links.ts`

**Akış:**
1. Share butonu (liste veya trip detayda) → POST /api/shared → nanoid(10) slug
2. `/shared/{slug}` — auth gerektirmez (middleware'de exempt)
3. GET /api/shared/{slug} — service role client (RLS bypass)
4. Liste: place list + harita | Trip: timeline + route polylines
5. Login'li kullanıcı: "Save to my lists/trips" → place'ler kopyalanır (duplicate-safe)
6. Logout: "Create your free account" CTA (viral büyüme)

**Devre dışı bırakma:** PATCH /api/shared → `is_active: false` → link 404 döner

**RLS:** `shared_links` tablosunda hem owner policy hem public read policy

---

### Service 13: Statistics Dashboard

**Dosyalar:**
- `src/app/api/stats/route.ts` — Parallel aggregate sorgular
- `src/lib/hooks/use-stats.ts` — 5dk stale time
- `src/app/(app)/stats/page.tsx` — Recharts dashboard

**Metrikler:**
| Widget | Veri Kaynağı | Chart |
|--------|-------------|-------|
| Hero stats (4) | COUNT, DISTINCT, AVG | Sayı kartları |
| Visit progress | GROUP BY visit_status | Progress bar |
| Category dağılımı | GROUP BY category_id JOIN categories | PieChart (donut) |
| Top 10 şehir | GROUP BY city ORDER BY count | BarChart (horizontal) |
| Aylık trend (12 ay) | GROUP BY month(created_at) | AreaChart |
| Rating dağılımı | GROUP BY rating | BarChart |

**Navigasyon:** Sidebar'da Lists ile Import arasında "Stats" linki

---

### Service 14: Theme & Appearance

**Dosyalar:**
- `src/lib/providers.tsx` — ThemeProvider (next-themes)
- `src/lib/hooks/use-map-style.ts` — mapStyle + markerStyle
- `src/app/(app)/settings/page.tsx` — Appearance tab

**Tema:**
- 3 mod: Light / Dark / System
- CSS: `globals.css` `:root` + `.dark` oklch variables
- Toggle: Header'da Sun/Moon/Monitor cycle button
- Persistence: localStorage (next-themes)

**Harita stili:**
- Auto (tema takibi), Streets, Satellite, Outdoors, Light, Dark
- MapView: `map.setStyle()` + layer re-apply on `style.load`

**Marker stili:**
- Icons: canvas-rendered Lucide SVG + kategori rengi daire (symbol layer)
- Dots: basit renkli daire + visit status stroke (circle layer)
- 12 ikon: utensils, coffee, wine, bed, shopping-bag, landmark, trees, waves, dumbbell, heart-pulse, ticket, map-pin

**Dark mode audit:** 14+ component'a `dark:` Tailwind variant'ları eklendi

---

## v2 Cross-Cutting Concerns

### Zustand (Import Store)
- Module-scope store: sayfa navigasyonlarında state korunur
- Phase machine: idle → options → importing → done
- Cancel: `getState().cancelled` batch arası kontrol

### Shared PostGIS Parser (`src/lib/geo.ts`)
- EWKB hex, WKT, GeoJSON, plain object desteği
- Tüm API route'lardan import edilir (tek kaynak)

### Service Role Client
- `createServiceClient()` — RLS bypass
- Sadece public sharing endpoint'inde kullanılır

### Cache Invalidation Stratejisi
- Place delete → `["places"]` + `["lists"]` + `["trips"]` + `["trip"]`
- Trip değişiklik → `["trip", tripId]`
- Import tamamlanma → `["places"]` + `["stats"]`

### Mapbox Directions API Maliyet
- Free: 100K request/ay
- Trip detail GET'te her gün için 1 request
- Sadece 2+ mekanlı günlerde çağrılır
