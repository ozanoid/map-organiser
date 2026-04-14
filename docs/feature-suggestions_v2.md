# Map Organiser — Feature Suggestions v2

> Bu doküman, iki bağımsız codebase analizinin cross-reference edilerek birleştirilmesi,
> duplike önerilerin konsolide edilmesi ve her feature'ın maksimum detayda
> tanımlanmasıyla oluşturulmuştur. Hiçbir öneri elenmemiştir.
>
> **Tarih:** 2026-04-14
> **Kaynak:** system-design_v1.md, design-system_v1.md, system_v1.md + full codebase audit

---

## Doküman Yapısı

```
PART 1 — Non-AI Features (F-01 → F-18)
  Group A: Core UX & Interaction
  Group B: Map & Visualization
  Group C: Organization & Planning
  Group D: Social & Sharing
  Group E: Data Management & Analytics
  Group F: Content & Media
  Group G: Platform Expansion

PART 2 — AI & LLM Features (AI-01 → AI-10)
  Group H: Intelligent Search & Interaction
  Group I: Smart Categorization & Tagging
  Group J: Content Generation & Analysis
  Group K: Discovery & Recommendation
  Group L: AI-Powered Planning
  Group M: Visual Intelligence

PART 3 — Priority Matrix & Roadmap
PART 4 — Cross-Cutting Technical Concerns
```

---

# PART 1 — NON-AI FEATURES

---

## Group A: Core UX & Interaction

### F-01: Manuel Mekan Ekleme (Drop Pin / Address Search)

**Kaynak:** Analiz-1 (P0)

**Ne:** Kullanıcı, Google Maps linki olmadan haritaya tıklayarak veya adres yazarak mekan ekleyebilmeli.

**Neden:**
- Şu an **yalnızca** Google Maps linki veya CSV/GeoJSON import ile mekan eklenebiliyor
- Kullanıcılar Google'da olmayan yerleri (bir arkadaşın evi, gizli plaj, yerel pazar) kaydedemiyorlar
- Rakip uygulamaların (Wanderlog, Polarsteps) tamamında bu özellik var — temel bir beklenti
- "Add Place" akışının en düşük friction versiyonu: haritada dokunup "burası" demek

**Kullanıcı Hikayeleri:**
- *"Arkadaşımın evini haritada işaretlemek istiyorum ama Google Maps linki yok."*
- *"Sahilde keşfettiğim gizli koy'u kaydetmek istiyorum, Google'da listed değil."*
- *"Adres yazarak hızlıca mekan eklemek istiyorum, her seferinde Google Maps'e gidip link kopyalamak zahmetli."*

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI: Drop Pin modu** | MapView'a "Drop Pin" toggle butonu. Aktifken haritaya tıklama → geçici marker + koordinat yakalama. Long-press alternatifi (mobil). |
| **UI: Address search** | AddPlaceDialog içinde yeni tab: "Search Address". Input + Mapbox Geocoding API ile autocomplete. Sonuç seçimi → koordinat + adres otomatik doldurma. |
| **API: Mapbox Geocoding** | `https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json` — mevcut Mapbox token kullanılır, ek maliyet minimal. |
| **API: Reverse Geocoding** | Drop pin koordinatı → `mapbox.places/{lng},{lat}.json` → adres, ülke, şehir otomatik çözümleme. |
| **DB değişikliği** | `places.source` enum'a `'manual_pin'` eklenmeli. Mevcut `'manual'` ile ayırt edilebilir. |
| **Google enrichment (opsiyonel)** | Pin'e en yakın Google Place → "Bu mu demek istediğiniz?" önerisi. Kabul ederse google_data doldurulur, reddetse minimal kayıt. |
| **Validasyon** | `name` ve `location` zorunlu. Kategori, notlar, etiketler opsiyonel (mevcut form ile aynı). |

**Bağımlılıklar:** Mapbox Geocoding API erişimi (mevcut token ile mümkün).

**Effort:** Orta (3-5 gün) — MapView'a interaction mode eklenmesi en karmaşık kısım.

**Impact:** 🔥🔥🔥 — Temel kullanım senaryosunu genişletir, Google bağımlılığını azaltır.

---

### F-02: Mekan Sıralama (Sorting)

**Kaynak:** Analiz-1 (P0)

**Ne:** Places sayfasında mekanları birden fazla kritere göre sıralayabilme.

**Neden:**
- 100+ mekanı olan kullanıcılar filtreleme ile bulduğu sonuçları önceliklendiremiyor
- "En yüksek puanlı" veya "en son eklenen" gibi temel sıralama ihtiyaçları karşılanmıyor
- Mevcut davranış: `created_at DESC` (implicit) — kullanıcı kontrolü yok

**Sıralama Kriterleri:**

| Kriter | DB Kolonu | Yön |
|--------|-----------|-----|
| İsim (A-Z / Z-A) | `name` | ASC / DESC |
| Ekleme tarihi | `created_at` | DESC (yeni → eski) / ASC |
| Kullanıcı rating | `rating` | DESC (en yüksek) |
| Google rating | `google_data->>'rating'` | DESC |
| Ziyaret tarihi | `visited_at` | DESC (en son ziyaret) |
| Şehir | `city` | ASC (alfabetik) |

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **URL param** | `?sort=rating_desc` veya `?sort=name_asc` — mevcut URL filter sistemiyle uyumlu |
| **useFilters hook** | `PlaceFilters` interface'e `sort?: string` eklenir |
| **API** | GET /api/places → Supabase `.order(column, { ascending })` — JSONB sort için `google_data->rating` |
| **UI** | Sort dropdown (native `<select>`) filtre panelinin üstünde veya Places header'da. İkon: `ArrowUpDown` |
| **Default** | `created_at DESC` (mevcut davranışı korur) |

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥🔥 — Her kullanıcının günlük ihtiyacı, düşük effort ile yüksek değer.

---

### F-03: Gelişmiş Arama & Kayıtlı Filtreler

**Kaynak:** Analiz-1 (P1)

**Ne:** Arama sonuçlarında compound filtreler + sık kullanılan filtre kombinasyonlarını kaydetme.

**Neden:**
- 9 ayrı filtre parametresi var — hepsini her seferinde ayarlamak zahmetli
- "İstanbul'daki 4+ puanlı restoranlar" gibi sık kullanılan kombinasyonlar tekrar tekrar oluşturuluyor
- Saved filter presets ile "one tap" erişim UX'i dramatik iyileştirir

**Alt Özellikler:**

**a) Saved Filter Presets:**
- Mevcut filtre kombinasyonunu "Kaydet" butonu ile preset olarak saklama
- Preset'e isim verme ("Istanbul Restaurants", "Beach Favorites")
- Filter panel üstünde preset chip'leri — tek tıkla yükle
- DB: `saved_filters` tablosu (user_id, name, filter_json, created_at)

**b) Quick Filter Suggestions:**
- En çok kullanılan filtre kombinasyonlarını otomatik tespit
- "Son 7 günde 5 kez kullandınız" → öner

**c) Filter History:**
- Son 10 filtre kombinasyonunu hatırla (localStorage)
- "Recent filters" bölümü

**Teknik Uygulama:**
- `saved_filters` tablosu + RLS
- GET/POST/DELETE `/api/filters` endpoints
- `useSavedFilters()` hook
- FilterPanel'e "Save current" + "Load preset" UI

**Effort:** Orta (3-4 gün)

**Impact:** 🔥🔥 — Power user'lar için büyük değer, casual kullanıcılar fark etmeyebilir.

---

### F-04: Mekan Karşılaştırma (Side-by-Side Comparison)

**Kaynak:** Analiz-2

**Ne:** 2-4 mekanı yan yana karşılaştırma tablosu (rating, fiyat, mesafe, çalışma saatleri, kullanıcı notu).

**Neden:**
- "Bu iki restorandan hangisine gidelim?" en yaygın karar senaryosu
- Google Maps'te bu mümkün değil — güçlü bir diferansiyasyon noktası
- Mevcut bulk select altyapısı (Set<string> ile selectedIds) zaten hazır

**Kullanıcı Hikayesi:**
- *"Istanbul'daki 3 Japon restoranını yan yana görmek istiyorum: rating, fiyat, mesafe, açılış saati."*

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Selection** | Mevcut bulk select mode kullanılır. "Compare" butonu BulkActionBar'a eklenir (2-4 seçim olduğunda aktif). |
| **UI** | `/places/compare?ids=uuid1,uuid2,uuid3` — responsif tablo/kart görünümü. Satırlar: fotoğraf, isim, adres, kategori, rating (user + Google), fiyat seviyesi, çalışma saatleri, kullanıcı notu, etiketler, ziyaret durumu. |
| **Mobil** | Horizontal scroll ile swipeable kart serisi |
| **Harita** | Karşılaştırma sayfasında mini harita — tüm mekanlar işaretli, aralarındaki mesafe gösterilir |
| **"Winner" badge** | En yüksek rating'e otomatik yeşil badge (opsiyonel, gamification) |

**Effort:** Orta (3-4 gün)

**Impact:** 🔥🔥 — Karar verme sürecini hızlandırır, unique feature.

---

### F-05: Quick Add — Voice & Shortcuts

**Kaynak:** Analiz-2

**Ne:** Sesle veya iOS/Android shortcut'ları ile mevcut konumdan hızlı mekan kaydetme.

**Neden:**
- Bir mekandayken telefonu çıkarıp link aramak zahmetli
- "Burası güzelmiş, kaydet" → konum + ses notu → sonra detaylandır
- iOS Shortcuts entegrasyonu docs'ta zaten bahsedilmiş (workaround olarak)

**Alt Özellikler:**

**a) Voice Add (PWA):**
- Web Speech API ile sesle mekan adı dikte etme
- AddPlaceDialog'da mikrofon butonu
- Transkripsiyon → Google search (mevcut searchPlace pipeline)

**b) iOS Shortcuts Integration:**
- Custom URL scheme: `maporganiser://add?lat={lat}&lng={lng}&name={name}`
- Veya web URL: `/map?add=current_location`
- iOS Shortcut template yayınlama (kullanıcının indirip kullanması için)

**c) "Quick Save" Modu:**
- Mevcut konumdan 1 tıkla kayıt: konum + tarih + "Want to Go" status
- Detaylar sonra doldurulur (minimal friction)
- Reverse geocoding ile adres + şehir + ülke otomatik

**Teknik Uygulama:**
- Web Speech API: `window.SpeechRecognition` (Chrome + Safari desteği)
- Geolocation API: `navigator.geolocation.getCurrentPosition()` (mevcut GeolocateControl ile aynı)
- API: POST /api/places → `source: 'quick_save'`, minimal fields

**Effort:** Orta (3-5 gün) — Speech API browser uyumluluğu test gerektirir.

**Impact:** 🔥🔥 — Mobil kullanıcılar için büyük friction azaltma. Native app ile daha güçlü.

---

## Group B: Map & Visualization

### F-06: Harita Stili, Dark Mode & Tema Sistemi

**Kaynak:** Analiz-1 (P0 + P1) + Analiz-2 — iki analizin birleşimi

**Ne:** Uygulama genelinde dark mode + haritada çoklu stil seçimi + kullanıcı tema tercihi.

**Neden:**
- Gece kullanımında göz yorucu (harita light-v11, UI beyaz arka plan)
- `next-themes` altyapısı zaten mevcut ama implement edilmemiş
- Farklı senaryolar farklı harita stilleri gerektirir (doğa: outdoors, navigasyon: streets, gece: dark)
- Modern bir uygulama beklentisi — kullanıcıların %60+'ı dark mode tercih ediyor

**Alt Özellikler:**

**a) App Dark Mode:**
- `ThemeProvider` aktifleştirme (next-themes)
- Tüm component'lara `dark:` Tailwind prefix'leri
- System preference desteği (`prefers-color-scheme`)
- Toggle: Settings veya header'da sun/moon ikonu

**b) Harita Stil Seçimi:**

| Stil | Mapbox ID | Kullanım |
|------|-----------|----------|
| Light (default) | `light-v11` | Günlük kullanım |
| Dark | `dark-v11` | Gece, dark mode |
| Streets | `streets-v12` | Detaylı sokak bilgisi |
| Satellite | `satellite-streets-v12` | Coğrafi keşif |
| Outdoors | `outdoors-v12` | Doğa, hiking |

**c) Kullanıcı Tercihi Saklama:**
- `profiles` tablosuna `theme_preference` (light/dark/system) + `map_style` (enum) kolonu
- Veya localStorage (DB sync olmadan, daha basit)

**Teknik Uygulama:**
- `next-themes` ThemeProvider → root layout'a wrap
- MapView'da `map.setStyle(newStyleUrl)` — mevcut markers/sources korunmalı (re-apply gerekir)
- Marker renkleri dark mode'da adjust (mevcut category renkleri dark arka planda görünürlük kontrolü)
- Tailwind v4 dark mode: `@media (prefers-color-scheme: dark)` veya `.dark` class strategy

**Bağımlılıklar:** next-themes (zaten yüklü), Tailwind dark mode config.

**Effort:** Orta-Yüksek (5-7 gün) — Tüm component'ların dark variant'ı + harita style switch mantığı.

**Impact:** 🔥🔥🔥 — Modern beklenti, gece kullanım deneyimini dramatik iyileştirir.

---

### F-07: Custom Map Markers / Kategori İkonları

**Kaynak:** Analiz-2

**Ne:** Haritada kategoriye özgü ikon marker'ları (sadece renkli daire değil, restaurant = çatal-bıçak, cafe = kahve bardağı gibi).

**Neden:**
- Şu an tüm mekanlar aynı `circle` shape — sadece renk farklı. Zoom out'ta hangi kategorinin nerede yoğun olduğu anlaşılmıyor.
- `categories.icon` alanı zaten mevcut (Lucide ikon adları) ama haritada kullanılmıyor
- Ikon marker'lar haritanın okunabilirliğini dramatik artırır (Google Maps'in kendi yaptığı gibi)

**Teknik Uygulama:**

| Yaklaşım | Artı | Eksi |
|-----------|------|------|
| **Mapbox SDF Icons** | Performanslı, native GL rendering | Her ikon için SDF sprite gerekir, oluşturması zahmetli |
| **Mapbox Symbol Layer** | `icon-image` property ile data-driven | Sprite atlas yönetimi gerekir |
| **HTML Markers (Overlay)** | Tam kontrol (React component), Lucide SVG doğrudan | 500+ markerde performans sorunu |
| **Canvas Marker (Hybrid)** ✅ | Kategori ikonlarını canvas'a render → image olarak Mapbox'a ekle | İlk yükleme maliyeti, sonra performanslı |

**Önerilen Yaklaşım:** Canvas Hybrid
1. Her kategori ikonu için Lucide SVG → 48x48 canvas → `map.addImage(categoryName, canvas)`
2. `unclustered-point` layer'ını `symbol` type'a çevir
3. `icon-image`: `["get", "categoryIcon"]` (data-driven)
4. Fallback: ikon bulunamazsa mevcut `circle` layer

**GeoJSON Feature güncelleme:**
```typescript
// Mevcut
{ categoryColor: "#EF4444", categoryIcon: "utensils" }
// Ek olarak harita sprite referansı:
{ categoryColor: "#EF4444", categoryIcon: "utensils", markerIcon: "cat-restaurant" }
```

**Effort:** Orta (4-5 gün) — Sprite generation + symbol layer migration.

**Impact:** 🔥🔥🔥 — Harita deneyimini tamamen dönüştürür, "wow effect" yaratır.

---

### F-08: Konum Zekası (Nearby Search + Proximity Alerts)

**Kaynak:** Analiz-1 (P1: Nearby) + Analiz-2 (Proximity Alerts) — iki farklı ama ilişkili özellik

Bu iki analiz farklı açılardan aynı temel ihtiyacı ele alıyor: **kullanıcının fiziksel konumuyla kayıtlı mekanlar arasındaki ilişki**.

**Alt Özellik A — Nearby Search (Yakın Mekanlar Filtresi):**

**Ne:** "Bana 2km içindeki kayıtlı mekanları göster" filtresi.

**Neden:** Seyahatte veya yeni bir şehirde "buralarda kaydettiğim bir yer var mıydı?" sorusuna anında cevap.

**Teknik:**
- PostGIS: `ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_meters)`
- Veya: `ST_Distance` ile sıralama
- UI: Geolocate butonunun yanında "Nearby" toggle + mesafe slider (500m, 1km, 2km, 5km, 10km)
- URL: `?nearby=lat,lng,radius`

**Alt Özellik B — Proximity Alerts (Yakınlık Bildirimi):**

**Ne:** "want_to_go" mekanlardan birine 500m yaklaştığında push notification.

**Neden:** Kaydettiğin mekanların yanından geçerken fark etmemek çok yaygın.

**Teknik:**
- **PWA sınırı:** Background Geolocation ve Geofencing API'leri PWA'da çok sınırlı — sadece foreground'da çalışır.
- **Gerçekçi yaklaşım (PWA):** Uygulama açıkken periyodik konum kontrolü (30s interval) + in-app banner notification
- **İdeal yaklaşım (Native App):** iOS CLLocationManager + Android Geofencing API → arka planda çalışır → push notification
- **Karma:** PWA'da "Check nearby" butonu (manuel tetikleme), native app'te otomatik

**DB değişikliği:** `places` tablosuna `notify_on_nearby: boolean` kolonu (kullanıcı mekan bazında açıp kapatabilir).

**Effort:** Nearby Search: Düşük (1-2 gün). Proximity Alerts PWA: Orta (3-4 gün). Native: Yüksek (native app gerektirir).

**Impact:** 🔥🔥🔥 (Nearby) / 🔥🔥 (Proximity — PWA sınırı nedeniyle tam etkisini native app'te gösterir).

---

## Group C: Organization & Planning

### F-09: Drag & Drop Liste Sıralama

**Kaynak:** Analiz-1 (P1)

**Ne:** Liste içindeki mekanları sürükleyerek sıralama.

**Neden:**
- `list_places.sort_order` kolonu DB'de zaten mevcut ama UI'da kullanılmıyor
- Seyahat planlamasında "önce şuraya, sonra buraya" sırası önemli
- Trip Planner (F-10) için prerequisite altyapı

**Teknik Uygulama:**
- `@dnd-kit/sortable` kütüphanesi (React DnD Kit — en performanslı, lightweight)
- Liste detay sayfasında (`/lists/[id]`) "Reorder" modu
- Drag handle ikonu her place card'ın solunda (GripVertical icon)
- Drop sonrası: PATCH `/api/lists/[id]/reorder` → tüm sort_order değerlerini güncelle
- Optimistic update: TanStack Query mutation ile anında UI güncellemesi

**Effort:** Düşük-Orta (2-3 gün)

**Impact:** 🔥🔥 — Seyahat planlayan kullanıcılar için önemli, Trip Planner'ın temeli.

---

### F-10: Seyahat Planlayıcı & Route Optimizasyonu

**Kaynak:** Analiz-1 (P2: Route Planlama) + Analiz-2 (Trip Planner) — birleştirildi

**Ne:** Bir listeye tarih aralığı atama, mekanları günlere dağıtma, gün içi sıralama, harita üzerinde rota görüntüleme.

**Neden:**
- Kullanıcılar "want_to_go" mekanları biriktiriyor ama bunları bir seyahat planına dönüştüremiyor
- Google Maps "My Maps" bu ihtiyacı kısmen karşılıyor ama organizasyon zayıf
- "Organize" → "Plan" → "Execute" döngüsünü tamamlar
- AI-08 (AI Trip Planner) için non-AI temel

**Modül Yapısı:**

**a) Trip Entity:**
```sql
CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  list_id uuid REFERENCES lists,  -- opsiyonel: mevcut liste ile ilişkilendir
  name text NOT NULL,
  destination_city text,
  destination_country text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE trip_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips ON DELETE CASCADE NOT NULL,
  day_number integer NOT NULL,
  date date NOT NULL,
  places jsonb DEFAULT '[]',  -- [{place_id, start_time, end_time, notes}]
  created_at timestamptz DEFAULT now()
);
```

**b) UI:**
- `/trips` sayfa: Trip listesi (kart grid)
- `/trips/[id]` detay: Timeline görünümü (gün bazlı)
- Gün içi mekan sıralaması: F-09 (drag & drop)
- Harita görünümü: Tüm günlerin mekanları renkli olarak, seçili günün rotası çizili

**c) Route Visualization:**
- Mapbox Directions API: `https://api.mapbox.com/directions/v5/mapbox/driving/{coordinates}`
- Günlük rota polyline'ı haritada gösterilir
- Toplam mesafe + tahmini süre

**d) "Booked" Entegrasyonu:**
- Trip'e mekan eklenince otomatik `visit_status: 'booked'`
- Trip tarihi geldiğinde → bildirim (F-17 ile entegre)

**Bağımlılıklar:** F-09 (Drag & Drop), Mapbox Directions API.

**Effort:** Yüksek (7-10 gün) — Yeni entity, CRUD, timeline UI, Mapbox Directions entegrasyonu.

**Impact:** 🔥🔥🔥 — Uygulamayı "organize tool"dan "planning tool"a dönüştürür. Premium feature potansiyeli.

---

## Group D: Social & Sharing

### F-11: Paylaşımlı Listeler & Public Links

**Kaynak:** Analiz-1 (P1: Liste Paylaşma) + Analiz-2 (Collaborative Lists) — birleştirildi

İki analiz farklı seviyeler öneriyordu: Analiz-1 read-only public link, Analiz-2 view/edit izinli collaborative lists. Her ikisi de dahil edildi.

**Alt Özellik A — Public Read-Only Link:**

**Ne:** Bir listeyi veya tek bir mekanı read-only public URL ile paylaşma.

**Neden:** "İstanbul restoran listem" gibi küratörlü koleksiyonları arkadaşlarla paylaşma ihtiyacı.

**Teknik:**
- `shared_links` tablosu:
  ```sql
  CREATE TABLE shared_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    resource_type text NOT NULL,  -- 'list' | 'place'
    resource_id uuid NOT NULL,
    slug text UNIQUE NOT NULL,    -- URL-friendly random slug
    is_active boolean DEFAULT true,
    expires_at timestamptz,       -- opsiyonel: süreli paylaşım
    view_count integer DEFAULT 0,
    created_at timestamptz DEFAULT now()
  );
  ```
- Public route: `/shared/[slug]` (auth gerektirmez)
- RLS bypass: shared_links üzerinden service role ile veri çekme
- UI: Liste veya mekan detay sayfasında "Share" butonu → link kopyalama

**Alt Özellik B — Collaborative Lists (İleri Seviye):**

**Ne:** Listeleri diğer kullanıcılarla view veya edit izinli paylaşma.

**Neden:** Arkadaşlarla seyahat planlarken kolektif liste oluşturma. Viral büyüme kanalı.

**Teknik:**
- `list_shares` junction tablosu:
  ```sql
  CREATE TABLE list_shares (
    list_id uuid REFERENCES lists ON DELETE CASCADE,
    shared_with_user_id uuid REFERENCES auth.users,
    permission text DEFAULT 'view',  -- 'view' | 'edit'
    invited_at timestamptz DEFAULT now(),
    PRIMARY KEY (list_id, shared_with_user_id)
  );
  ```
- Invite mekanizması: email ile davet veya invite link
- RLS güncelleme: `list_shares` üzerinden erişim kontrolü
- Real-time: Supabase Realtime ile eşzamanlı düzenleme bildirimi

**Effort:** Public Link: Düşük-Orta (2-3 gün). Collaborative: Yüksek (7-10 gün) — RLS karmaşıklığı, real-time sync.

**Impact:** 🔥🔥🔥 — Viral büyüme kanalı. Her paylaşılan link potansiyel yeni kullanıcı.

---

## Group E: Data Management & Analytics

### F-12: Export & Backup

**Kaynak:** Analiz-1 (P0) + Analiz-2 — her iki analizde de yüksek öncelik

**Ne:** Mekanları CSV, JSON, GeoJSON, KML formatlarında dışa aktarma. Opsiyonel periyodik backup.

**Neden:**
- Import var ama export yok → **veri kilidi (data lock-in) hissi** yaratır
- Kullanıcı güveni: "Verim bende, istediğim zaman çıkarabilirim"
- Google Maps'e geri aktarma (KML), başka araçlarla entegrasyon
- GDPR uyumu: kullanıcının verilerini talep hakkı

**Desteklenen Formatlar:**

| Format | Kullanım | İçerik |
|--------|----------|--------|
| **CSV** | Spreadsheet, diğer araçlar | name, address, country, city, lat, lng, category, rating, status, notes, tags, google_url |
| **GeoJSON** | Harita araçları, geojson.io | FeatureCollection + properties |
| **KML** | Google Earth, Google My Maps | Placemark + description |
| **JSON** | Geliştirici, backup | Tam veri (google_data dahil) |

**Teknik Uygulama:**
- `GET /api/places/export?format=csv&country=Turkey&category=xxx`
- Mevcut filtreler uygulanır (filtrelenmemiş = tüm mekanlar)
- Büyük veri setleri için streaming response (`ReadableStream`)
- UI: Places sayfasında "Export" butonu (Download icon) → format seçim dropdown
- Periyodik backup: Vercel Cron Job → haftalık JSON export → Supabase Storage'a kaydet (opsiyonel, premium feature)

**Effort:** Düşük-Orta (2-4 gün)

**Impact:** 🔥🔥🔥 — Kullanıcı güveni + GDPR uyumu. Düşük effort ile kritik değer.

---

### F-13: Duplikat Tespiti & Birleştirme

**Kaynak:** Analiz-1 (P2 + AI bölümü) + Analiz-2 — her iki analizde de mevcut

**Ne:** Benzer mekanları tespit etme, kullanıcıya birleştirme önerisi sunma.

**Neden:**
- CSV import + manuel ekleme → duplikat riski yüksek
- Mevcut kontrol sadece `google_place_id` bazlı (import sırasında)
- Farklı URL'lerden aynı mekan farklı ID ile gelebilir
- "Starbucks Nişantaşı" ve "Starbucks - Teşvikiye" aynı yer olabilir

**Tespit Katmanları:**

| Katman | Yöntem | Hassasiyet |
|--------|--------|------------|
| **Exact match** | `google_place_id` eşleşmesi | %100 — zaten mevcut |
| **Proximity** | PostGIS `ST_DWithin(location, location, 100)` — 100m içindeki aynı kategorideki mekanlar | Yüksek |
| **Name similarity** | PostgreSQL `pg_trgm` extension → `similarity(name, name) > 0.6` | Orta |
| **AI-enhanced** | Claude ile isim + adres çiftlerini değerlendirme (AI-06 ile ilişkili) | En yüksek |

**Teknik Uygulama:**
- `pg_trgm` extension'ı Supabase'de aktifleştirme
- `/api/places/duplicates` endpoint → aday çiftleri döndür
- UI: Settings veya Places sayfasında "Find Duplicates" butonu
- Merge akışı: İki mekanı yan yana göster → hangisinin verisini tutmak istediğini sor → birleştir (tag'ler union, notlar concat, en yüksek rating korunur)
- Merge API: POST `/api/places/merge` → primary_id + secondary_id → junction tablolar güncelle, secondary sil

**Bağımlılıklar:** `pg_trgm` Supabase extension.

**Effort:** Orta (4-5 gün)

**Impact:** 🔥🔥 — Veri hijyeni, import sonrası kritik.

---

### F-14: İstatistik Dashboard

**Kaynak:** Analiz-1 (P1) + Analiz-2 — her iki analizde de mevcut

**Ne:** Kullanıcının mekan verilerinden görsel özetler ve insight'lar.

**Neden:**
- Gamification: "15 ülkede 342 mekan keşfettin!" → motivasyon
- Progress tracking: "Bu ay 8 yeni mekan ziyaret ettin"
- Veri zaten zengin, sadece görselleştirme eksik
- Retention artırıcı: kullanıcılar istatistiklerini kontrol etmek için geri gelir

**Dashboard Bileşenleri:**

| Widget | Veri | Görsel |
|--------|------|--------|
| Toplam mekan sayısı | `COUNT(*)` | Büyük sayı + trend oklu |
| Ülke/şehir dağılımı | `GROUP BY country` | Bar chart veya dünya haritası heat map |
| Kategori dağılımı | `GROUP BY category_id` | Donut/pie chart (kategori renkleriyle) |
| Ziyaret durumu dağılımı | `GROUP BY visit_status` | Stacked bar veya pill istatistikleri |
| Aylık ekleme trendi | `GROUP BY DATE_TRUNC('month', created_at)` | Line chart |
| Rating dağılımı | `GROUP BY rating` | Histogram |
| En çok mekan eklenen şehirler | `GROUP BY city ORDER BY count DESC LIMIT 10` | Ranked list |
| Ziyaret timeline | `visited_at` bazlı | Calendar heatmap (GitHub benzeri) |

**Teknik Uygulama:**
- `/stats` veya `/dashboard` sayfası
- `GET /api/stats` endpoint → aggregate sorguları (tek DB round-trip, CTE kullanarak)
- Chart kütüphanesi: **Recharts** (lightweight, React-native, SSR-friendly)
- Responsive: Mobilde kart stack, desktop'ta grid layout
- Caching: React Query ile 5 dakika stale time (sık değişen veri değil)

**Effort:** Orta (3-5 gün)

**Impact:** 🔥🔥🔥 — Gamification + retention. Kullanıcılar istatistiklerini paylaşmak ister (social loop).

---

## Group F: Content & Media

### F-15: Zengin Notlar & Kullanıcı Medyası

**Kaynak:** Analiz-1 (P2: Kullanıcı Fotoğraf/Yorum) + Analiz-2 (Place Notes & Media) — birleştirildi

**Ne:** Markdown destekli notlar + kullanıcının kendi fotoğraflarını yükleyebilmesi.

**Neden:**
- Şu anda `notes` sadece düz text — biçimlendirme yok
- Kullanıcılar kendi deneyimlerini belgelemek istiyor (yemek fotoğrafı, menü, manzara)
- `place_photos` tablosu DB'de mevcut (caption ile) ama UI yok
- "Google'dan bağımsız kişisel mekan arşivi" vizyonunu güçlendirir

**Alt Özellikler:**

**a) Rich Text Notes:**
- Mevcut `notes` textarea → minimal rich text editor
- Kütüphane önerisi: **Tiptap** (ProseMirror tabanlı, lightweight, headless)
- Desteklenen formatlar: bold, italic, bullet list, numbered list, heading, link
- Kaydedilen format: HTML veya JSON (Tiptap native)
- DB: `notes` kolonu text olarak kalır (HTML/JSON string)

**b) Kullanıcı Fotoğraf Yükleme:**
- `place_photos` tablosu zaten mevcut: `(id, place_id, storage_path, caption)`
- Supabase Storage: mevcut `place-photos` bucket'ına `{user_id}/{place_id}/user_{index}.jpg`
- Upload UI: mekan detay sayfasında "Add Photo" butonu
- Galeri: Google fotoğraf (1) + kullanıcı fotoğrafları (çoklu) grid görünümü
- Limit: mekan başına max 10 kullanıcı fotoğrafı, her biri max 5MB

**Effort:** Rich text: Düşük-Orta (2-3 gün). Fotoğraf: Orta (3-4 gün).

**Impact:** 🔥🔥 — Kişiselleştirme, "benim arşivim" hissi güçlenir.

---

### F-16: Aktivite Logu & Mekan Geçmişi

**Kaynak:** Analiz-1 (P2)

**Ne:** "2 hafta önce visited olarak işaretledin", "Bu mekanı 3 kez güncelledin" gibi aktivite akışı.

**Neden:**
- Kullanıcı kendi kullanım örüntüsünü göremiyors — engagement eksikliği
- "Ne zaman ekledim bunu?" sorusuna cevap (created_at var ama görsel timeline yok)
- Trip geçmişi oluşturma (sonradan)

**Teknik Uygulama:**
- `activity_log` tablosu:
  ```sql
  CREATE TABLE activity_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    action text NOT NULL,       -- 'create' | 'update' | 'delete' | 'visit' | 'rate' | 'add_to_list'
    resource_type text NOT NULL, -- 'place' | 'list' | 'tag' | 'category'
    resource_id uuid,
    metadata jsonb DEFAULT '{}', -- {old_status, new_status, rating, list_name, ...}
    created_at timestamptz DEFAULT now()
  );
  ```
- Logging: Her API mutation'da fire-and-forget log insert
- UI: `/activity` sayfası veya settings altında "Activity" tab
- Timeline görünümü: günlük gruplandırılmış aktivite kartları

**Effort:** Orta (3-4 gün)

**Impact:** 🔥 — Nice-to-have, retention'a dolaylı katkı. İstatistik dashboard (F-14) ile birleştirilebilir.

---

## Group G: Platform Expansion

### F-17: Bildirimler & Hatırlatıcılar

**Kaynak:** Analiz-1 (P2)

**Ne:** "Booked" mekanlara tarih ekleme ve o güne yaklaştığında bildirim. Genel in-app notification sistemi.

**Neden:**
- `booked_at` alanı mevcut ama sadece "ne zaman booked olarak işaretlendi" için kullanılıyor
- Gelecek tarihli rezervasyonlar için hatırlatma yok
- Trip Planner (F-10) ile doğal entegrasyon: trip günü yaklaşırken bildirim

**Alt Özellikler:**

**a) Rezervasyon Tarihi:**
- `places` tablosuna `reservation_date timestamptz` kolonu (gelecek tarih)
- UI: Mekan detayında "Add reservation date" date picker
- "Booked" status seçildiğinde otomatik date picker göster

**b) Push Notification (PWA):**
- Web Push API + Service Worker
- Supabase Edge Function (cron): günlük kontrol → yarın/bugün olan rezervasyonları bul → push gönder
- Kullanıcı izni: ilk bildirimde `Notification.requestPermission()`

**c) In-App Notification Center:**
- Header'da bell ikonu + badge sayacı
- Bildirim tipleri: reservation reminder, import complete, shared list invite, nearby alert
- `notifications` tablosu: (user_id, type, title, body, read, created_at)

**Effort:** Push: Orta-Yüksek (5-7 gün). In-app: Orta (3-4 gün).

**Impact:** 🔥🔥 — Engagement artırıcı, PWA'yı native app hissiyatına yaklaştırır.

---

### F-18: Çoklu Dil Desteği (i18n)

**Kaynak:** Analiz-1 (P2)

**Ne:** Uygulama arayüzünü en az Türkçe ve İngilizce olarak sunma.

**Neden:**
- Geliştirici Türkçe konuşuyor, dokümantasyon Türkçe, ama UI tamamen İngilizce
- Kullanıcı tabanı potansiyel olarak çok dilli (seyahat uygulaması → uluslararası kullanıcılar)
- Next.js App Router'da i18n desteği native

**Teknik Uygulama:**
- `next-intl` veya `next-international` kütüphanesi
- `/[locale]/` route prefix: `/en/map`, `/tr/map`
- Çeviri dosyaları: `messages/en.json`, `messages/tr.json`
- Dil seçimi: browser preference + settings'te override
- Kategori/tag/list isimleri ÇEVRİLMEZ (kullanıcı oluşturmuş veri)

**Effort:** Yüksek (5-8 gün) — Tüm string'lerin extraction'ı + çeviri + routing.

**Impact:** 🔥 — Uluslararası büyüme için gerekli ama mevcut kullanıcı tabanı için acil değil.

---

# PART 2 — AI & LLM FEATURES

> **Ortak Mimari Kararlar** (tüm AI feature'lar için):
> - **LLM Provider:** Claude API (Haiku: düşük maliyet günlük işlemler, Sonnet: karmaşık reasoning)
> - **Integration:** Vercel AI SDK v6 (streaming, structured output, tool calling)
> - **API Key Yönetimi:** Mevcut per-user encryption pattern (`profiles.google_api_key_enc`) genişletilir → `anthropic_api_key_enc`
> - **Alternatif:** Server-side tek Anthropic API key + kullanıcı bazlı usage tracking (mevcut `api_usage` tablosu genişletilir)
> - **Cache:** AI sonuçları `google_data` JSONB'ye `ai_*` prefix'li alanlar olarak cache'lenir
> - **Fallback:** AI başarısız → mevcut rule-based sistem devam eder
> - **Rate Limit:** Aylık AI istek limiti (free: 50, premium: sınırsız)

---

## Group H: Intelligent Search & Interaction

### AI-01: Doğal Dil ile Filtreleme & Sorgulama

**Kaynak:** Analiz-1 + Analiz-2 (her ikisinde de en yüksek öncelikli AI feature)

**Ne:** "İstanbul'daki 4+ puanlı deniz ürünleri restoranları" veya "geçen ay gittiğim kafeler" gibi serbest metin sorgusunu mevcut `PlaceFilters` parametrelerine dönüştürme.

**Neden:**
- 9 ayrı filtre parametresi var — hepsini ayarlamak zahmetli
- Mobilde filtre sheet'i açıp 5 farklı dropdown/pill ayarlamak friction yaratır
- Doğal dil ile tek cümle → tüm filtreler → anında sonuç
- Mevcut filter altyapısıyla tam uyumlu — UI'da filtreler otomatik ayarlanır

**Kullanıcı Örnekleri:**

| Doğal Dil Sorgusu | Beklenen PlaceFilters Output |
|--------------------|-----------------------------|
| "favorilerim" | `{ visit_status: "favorite" }` |
| "İstanbul'daki barları göster" | `{ city: "Istanbul", category_ids: ["bar_uuid"] }` |
| "4+ puanlı restoranlar" | `{ category_ids: ["restaurant_uuid"], rating_min: 4 }` |
| "geçen hafta eklediğim yerler" | `{ created_after: "2026-04-07" }` (zaman ifadesi parse) |
| "Londra'da gitmek istediğim kafeler" | `{ city: "London", category_ids: ["cafe_uuid"], visit_status: "want_to_go" }` |
| "beach tag'li mekanlar" | `{ tag_ids: ["beach_tag_uuid"] }` |

**Teknik Uygulama:**

```
Kullanıcı metni
  → POST /api/ai/parse-query
  → Context oluştur: { categories: [...], tags: [...], cities: [...], countries: [...] }
  → Claude API (Haiku) + Structured Output (Zod schema = PlaceFilters)
  → Return: PlaceFilters JSON
  → Client: setFilters(result) → anında UI güncelleme
```

**Claude Prompt Stratejisi:**
```
System: Sen bir mekan filtreleme asistanısın. Kullanıcının doğal dil sorgusunu
aşağıdaki filtre yapısına dönüştür.

Mevcut kategoriler: [Restaurant (uuid1), Cafe (uuid2), Bar (uuid3), ...]
Mevcut etiketler: [rooftop (uuid-a), family-friendly (uuid-b), ...]
Mevcut ülkeler: [Turkey, UK, France, ...]
Mevcut şehirler: [Istanbul, London, Paris, ...]

Filtre yapısı (PlaceFilters):
{
  country?: string,
  city?: string,
  category_ids?: string[],  // UUID dizisi
  tag_ids?: string[],
  visit_status?: "want_to_go" | "booked" | "visited" | "favorite",
  rating_min?: number,       // 1-5
  google_rating_min?: number,
  search?: string            // serbest metin arama
}

User: {kullanıcı sorgusu}
```

**UI Entegrasyonu:**
- Mevcut arama çubuğunun yanında "✨ AI" toggle chip
- Aktifken input placeholder: "Doğal dilde ara... (ör: 'Paris'teki en iyi restoranlar')"
- Loading state: skeleton filtre pill'leri
- Sonuç: filtre pill'leri otomatik doldurlur + toast: "3 filtre uygulandı"
- Hata: "Anlayamadım. Lütfen filtreleri manuel olarak seçin." + fallback normal arama

**Maliyet:** Claude Haiku: ~$0.0005/sorgu (input: ~200 token context + query, output: ~50 token JSON)

**Effort:** Düşük (2-3 gün) — Mevcut filter altyapısı tam uyumlu, sadece parse layer ekleniyor.

**Impact:** 🔥🔥🔥 — En düşük effort / en yüksek algılanan değer oranı. "Wow" anı yaratır.

---

### AI-02: Mekan Chatbot (Conversational Discovery)

**Kaynak:** Analiz-2 (AI-6)

**Ne:** "Bu akşam için romantik bir yer önerir misin?" tarzı sohbet arayüzü ile kullanıcının kendi mekanları arasında keşif.

**Neden:**
- En doğal keşif yöntemi — "Ne yesem?" sorusuna kişiselleştirilmiş cevap
- RAG ile kullanıcının tüm mekan verisini context'e koyarak sohbet
- Multi-turn: tercih daraltma ("Bütçe?", "Konum?", "Mutfak?")
- AI-01 (doğal dil filtre) ile entegre ama daha zengin: önerileri açıklar, karşılaştırır

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | `/chat` sayfası veya FloatingActionButton → slide-up chat panel |
| **Streaming** | Vercel AI SDK `useChat()` hook → streaming response |
| **Context (RAG)** | Kullanıcının tüm mekanları → her turda context'e koy. 500+ mekan → özetlenmiş context (kategori/şehir bazlı aggregation) |
| **Tool Calling** | Claude tool use: `search_places(filters)` → mevcut API'yi çağır → sonuçları sohbete dahil et |
| **Memory** | Son 10 mesaj context'te tutulur. Önceki sohbetler kaydedilmez (basitlik). |
| **Sonuç** | Mekan önerildiğinde inline card preview (tıkla → mekan detay) |

**Claude System Prompt:**
```
Sen bir mekan öneri asistanısın. Kullanıcının kişisel mekan arşivinden
en uygun mekanları öner. Kullanıcının {count} mekanı var:
- {city_count} şehirde, {country_count} ülkede
- Kategoriler: {category_distribution}
- Favori mekanları: {top_rated_places}

search_places tool'unu kullanarak kullanıcının mekanlarını sorgulayabilirsin.
Türkçe veya İngilizce yanıt ver (kullanıcının diline göre).
```

**Maliyet:** Claude Sonnet: ~$0.01-0.03/tur (context boyutuna göre). Haiku: ~$0.002/tur.

**Effort:** Orta-Yüksek (5-7 gün) — Chat UI + Vercel AI SDK + tool calling + context management.

**Impact:** 🔥🔥🔥 — Güçlü diferansiyasyon. "Kendi mekan verinle konuşan asistan" unique bir deneyim.

---

## Group I: Smart Categorization & Tagging

### AI-03: Akıllı Kategorizasyon (LLM-Enhanced)

**Kaynak:** Analiz-1 + Analiz-2 (AI-4) — her ikisinde de mevcut

**Ne:** Mevcut rule-based 300+ type mapping'e ek olarak / yerine LLM ile daha akıllı kategori atama.

**Neden:**
- Rule-based sistem basit eşleşmelerde iyi: `restaurant_type → Restaurant`
- Kenar durumlar: "Blue Lagoon" → Beach (rule yakalayamaz), "The Library" → Cafe (kitap temalı kafe), "Sunset Lounge" → hem bar hem restoran
- LLM mekanın tüm context'ini (isim, adres, Google types, reviews highlight) değerlendirerek daha doğru seçim yapar
- Import sırasında "Other"a düşen mekan oranı %15 → LLM ile %3'e düşürülebilir

**Çalışma Modları:**

**a) Tek Mekan (Link ile Ekleme):**
```
ParsedPlaceData (name, types, address, reviews[0..2]) 
  → Claude Haiku prompt
  → Kullanıcının 12+ kategorisi context'te
  → Önerilen kategori + confidence score
  → Yüksek confidence (>0.8): otomatik ata
  → Düşük confidence: "Restaurant mı Cafe mi?" → kullanıcıya sor
```

**b) Batch (Import):**
```
100 mekan → 10'arlı batch → Claude Haiku
  → Her batch tek API call (structured output: [{place_index, category_name, confidence}])
  → Fallback: confidence < 0.5 → mevcut rule-based
```

**Claude Prompt:**
```
Kullanıcının kategorileri: Restaurant, Cafe, Bar & Nightlife, Hotel, Shopping, 
Museum, Park, Beach, Gym, Health, Entertainment, Other

Mekan bilgisi:
- İsim: {name}
- Adres: {address}
- Google türleri: {types}
- Varsa kısa tanım: {first_review_snippet}

Bu mekan için en uygun kategoriyi seç. Confidence (0-1) ver.
```

**Maliyet:** Haiku: ~$0.001/mekan. 100 mekan batch: ~$0.10.

**Effort:** Düşük (1-2 gün) — Mevcut resolveCategoryId() fonksiyonuna LLM layer ekleme.

**Impact:** 🔥🔥 — Kalite iyileştirme. Kullanıcı fark etmeyebilir ama "Other" oranındaki düşüş veri kalitesini artırır.

---

### AI-04: Otomatik Etiket Önerisi

**Kaynak:** Analiz-1

**Ne:** Mekan eklerken veya import sırasında LLM'nin otomatik etiket önerisi sunması.

**Neden:**
- Kullanıcılar genellikle etiket eklemeyi unutur veya tutarsız etiketler kullanır
- LLM mekanın türüne, konumuna ve Google verisine bakarak tutarlı etiketler önerebilir
- "outdoor-seating", "family-friendly", "michelin", "rooftop", "pet-friendly", "live-music" gibi yaygın etiketler

**Teknik Uygulama:**

```
ParsedPlaceData + Kullanıcının mevcut etiket listesi
  → Claude Haiku prompt
  → 3-5 etiket önerisi (mevcut etiketlerle tutarlı)
  → UI: AddPlaceDialog'da "Suggested tags" chip'leri
  → Kullanıcı kabul/reddet (toggle)
  → Yeni etiket öneriliyorsa: "Bu etiketi oluşturmak ister misiniz?" confirm
```

**Context Zenginleştirme:**
- Kullanıcının mevcut tag listesi → LLM bunlardan seçsin (tutarlılık)
- Google reviews'dan anahtar kelimeler (varsa)
- Mekan türü + konum bilgisi

**Maliyet:** Haiku: ~$0.001/mekan.

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥 — Etiket kullanımını artırır → filtre deneyimini iyileştirir.

---

## Group J: Content Generation & Analysis

### AI-05: Mekan Özeti & Review Sentezi

**Kaynak:** Analiz-1 + Analiz-2 (AI-3) — her ikisinde de mevcut

**Ne:** Google reviews'den 2-3 cümlelik kişiselleştirilmiş mekan özeti üretme.

**Neden:**
- `editorialSummary` Google API'den **maliyet nedeniyle tamamen kaldırıldı** ($25/1K Enterprise+Atmosphere tier)
- 200 Google review'ı okumak pratik değil
- LLM ile reviews'ı özetleyerek benzer (hatta daha iyi) bir sonuç **çok daha ucuza** elde edilebilir
- Kullanıcı dilinde (Türkçe/İngilizce) özet — Google editorialSummary sadece İngilizce

**İki Aşamalı Yaklaşım:**

**Aşama 1 — Review Özeti (Google reviews varsa):**
```
Google reviews (Enterprise tier, on-demand — zaten mevcut refresh butonu)
  → Son 10 review text'i → Claude Haiku
  → 2-3 cümle özet: atmosfer, yemek kalitesi, servis, fiyat/performans
  → Cache: google_data.ai_summary
  → Dil: kullanıcının browser/profile diline göre
```

**Aşama 2 — Meta Özet (reviews yoksa):**
```
Mekan adı + türleri + rating + user_ratings_total + fiyat seviyesi + konum
  → Claude Haiku → genel tanımlayıcı özet
  → "Nişantaşı'nda popüler bir Japon restoranı. 4.5 puan, 1200+ değerlendirme."
```

**Örnek Output:**
```
"Rahat atmosferi ve lezzetli kahvaltısıyla bilinen, Karaköy'deki bu cafe 
özellikle brunch saatlerinde yoğunlaşıyor. Servis biraz yavaş olabilir 
ama fiyat/performans oranı iyi. Teras bölümü manzaralı."
```

**Cache Stratejisi:**
- İlk üretimden sonra `google_data.ai_summary` alanına kaydet
- Refresh butonu: reviews yenilenince özet de yenilenir
- Stale check: 90 gün sonra yeniden üret (opsiyonel)

**Maliyet:** Haiku: ~$0.002/mekan (10 review input + özet output).

**Effort:** Düşük (2-3 gün)

**Impact:** 🔥🔥🔥 — editorialSummary'nin yerine geçer, mekan detay sayfasını zenginleştirir.

---

### AI-06: Review Sentiment Analizi

**Kaynak:** Analiz-1

**Ne:** Google reviews'in kategorize edilmiş sentiment analizi: yemek, servis, atmosfer, fiyat gibi temalarda pozitif/negatif oranları.

**Neden:**
- Tek bir sayısal rating (4.5) mekanın güçlü ve zayıf yönlerini göstermiyor
- "Yemek mükemmel ama servis berbat" bilgisi rating'den okunamaz
- Yapılandırılmış sentiment, mekan karşılaştırmasını (F-04) çok daha anlamlı kılar

**Analiz Boyutları:**

| Tema | Anahtar Kelimeler |
|------|-------------------|
| Yemek/İçecek Kalitesi | food, taste, flavor, fresh, delicious, yemek, lezzet |
| Servis | service, waiter, staff, friendly, slow, servis, garson |
| Atmosfer / Ambiyans | atmosphere, cozy, view, decor, ambiance, atmosfer, manzara |
| Fiyat / Değer | price, value, expensive, cheap, worth, fiyat, pahalı |
| Temizlik | clean, hygiene, dirty, temiz |
| Konum / Erişim | location, parking, access, konum, ulaşım |

**Output Formatı:**
```json
{
  "ai_sentiment": {
    "overall": "positive",
    "themes": {
      "food": { "score": 0.92, "label": "Çok Olumlu", "highlight": "Taze malzeme ve zengin lezzet" },
      "service": { "score": 0.58, "label": "Karışık", "highlight": "Bazen yavaş, ama güler yüzlü" },
      "atmosphere": { "score": 0.85, "label": "Olumlu", "highlight": "Teras manzarası harika" },
      "price": { "score": 0.70, "label": "Olumlu", "highlight": "Porsiyon/fiyat dengeli" }
    },
    "generated_at": "2026-04-14T12:00:00Z"
  }
}
```

**UI:** Mekan detay sayfasında horizontal bar chart'lar (tema bazlı, renk kodlu).

**Maliyet:** Haiku: ~$0.003/mekan (reviews input daha uzun).

**Effort:** Orta (3-4 gün) — Prompt engineering + sentiment UI.

**Impact:** 🔥🔥 — Premium hissiyat. Mekan detay sayfasını ciddi zenginleştirir.

---

## Group K: Discovery & Recommendation

### AI-07: Kişiselleştirilmiş Mekan Önerileri (Recommendation Engine)

**Kaynak:** Analiz-1 + Analiz-2 (AI-1) — her ikisinde de mevcut

**Ne:** Kullanıcının mevcut mekan profiline (kategoriler, şehirler, rating örüntüleri) bakarak yeni mekan önerileri.

**Neden:**
- Uygulamayı "organize tool"dan "discovery platform"a dönüştürür
- Kullanıcı profili zaten zengin: kategori tercihleri, rating pattern'leri, coğrafi dağılım
- "Visited" + "Favorite" mekanlardan çıkarılan tercih profili çok değerli
- Retention artırıcı: "Her hafta yeni öneriler" → geri gelme motivasyonu

**Mimari Yaklaşım — İki Seviye:**

**Seviye 1 — Rule-Based + LLM (Hemen uygulanabilir):**
```
1. Kullanıcı profili çıkar:
   - En sevilen kategoriler (favorite + 4-5 rating mekanları)
   - Aktif şehirler (en çok mekan olan)
   - Ortalama rating, fiyat seviyesi tercihi
2. Google Nearby Search API ile o şehirde profil ile eşleşen mekanlar ara
3. Claude ile sonuçları re-rank + kişiselleştirilmiş açıklama üret
4. "Bunu beğenebilirsin" önerisi sun
```

**Seviye 2 — Embedding Based (İleri aşama):**
```
1. Supabase pgvector extension aktifleştir
2. Her mekanın embedding'ini oluştur (isim + adres + kategori + notlar + tags)
3. Cosine similarity ile benzer mekanlar bul
4. Kullanıcının "visited + favorite" mekan embedding'lerinin ortalaması = profil vektörü
5. Profil vektörüne en yakın yeni mekanlar = öneriler
```

**UI:**
- `/discover` veya `/explore` sayfası
- "Size Özel" bölümü — 5-10 mekan önerisi
- Her öneride: Google data + "Neden öneriyoruz: Karaköy'deki favori cafelerinize benziyor"
- "Kaydet" butonu → hızlı ekleme (want_to_go status ile)

**Maliyet:**
- Seviye 1: Google Nearby Search ($32/1K) + Claude Haiku ($0.005/batch) → ~$0.04/öneri seti
- Seviye 2: pgvector sorgusu (ücretsiz) + embedding generation (one-time)

**Effort:** Seviye 1: Orta (4-5 gün). Seviye 2: Yüksek (8-10 gün, pgvector setup dahil).

**Impact:** 🔥🔥🔥 — Uygulamanın değer önerisini köklü genişletir. Premium subscription motivasyonu.

---

### AI-08: Akıllı Import (AI-Powered Enrichment)

**Kaynak:** Analiz-2 (AI-7)

**Ne:** Import sırasında eksik bilgileri LLM ile tamamlama, belirsiz mekanları resolve etme, başarısız eşleşme oranını düşürme.

**Neden:**
- Import sırasında %10-15 mekan "failed" oluyor (Google API bulamıyor)
- Ambiguous matches: "Los Compadres" → 3 sonuç varsa hangisi?
- CSV'deki notlardan ek context çıkarılabilir ("Berlin'deki küçük Italian")
- LLM ile failed oranı %3'e düşürülebilir

**Çalışma Akışı:**

```
Mekan import (mevcut pipeline)
  → Google API araması başarısız veya ambiguous
  → AI Enrichment layer:
    a) Mekan adı + not + CSV tags → Claude Haiku
    b) "Berlin'deki 'Los Compadres' muhtemelen Mexican restoran. Tam adres: ..."
    c) Refined search query → Google API 2. deneme
    d) Hâlâ başarısız → minimal kayıt (sadece isim + konum tahmini)
```

**Ambiguity Resolution:**
```
Google: 3 sonuç "Los Compadres"
  → Claude: Kullanıcının diğer mekanlarına bak
    - Çoğu Berlin'de → Berlin'deki sonucu seç
    - Çoğu restoran → restaurant olanı seç
  → Confidence score ile seçim
```

**Otomatik Tag Önerisi (Import sırasında):**
- AI-04 (etiket önerisi) import pipeline'ına entegre
- Her mekan için 2-3 tag önerisi → toplu onay ekranı

**Maliyet:** Haiku: ~$0.002/başarısız mekan. 100 mekan import'ta ~15 başarısız → ~$0.03 ek maliyet.

**Effort:** Orta (3-4 gün) — Mevcut import pipeline'a enrichment layer.

**Impact:** 🔥🔥 — Import kalitesini artırır, "failed" mektuplarının oranını düşürür.

---

## Group L: AI-Powered Planning

### AI-09: AI Seyahat Planlama Asistanı

**Kaynak:** Analiz-1 + Analiz-2 (AI-5) — her ikisinde de mevcut

**Ne:** "3 günlük İstanbul planı yap" → kullanıcının kayıtlı mekanlarından + yeni önerilerden optimum gün planı üretme.

**Neden:**
- Kayıtlı mekanlar özellikle seyahat planlama için biriktiriliyor
- LLM mekanları mesafe, kategori, çalışma saatlerine göre günlere dağıtabilir
- "Organize" → "Plan" → "Execute" döngüsünü AI ile tamamlar
- F-10 (Trip Planner) ile entegre: AI planı otomatik trip'e dönüştürür

**Girdi:**
- Şehir + gün sayısı
- Kullanıcının o şehirdeki "want_to_go" mekanları
- Opsiyonel: tercih profili (sabah kahve, öğle müze, akşam restoran)
- Opsiyonel: konaklama noktası (otel koordinatları → rota optimizasyonu)

**Claude Prompt:**
```
System: Sen bir seyahat planlama asistanısın. Kullanıcının kayıtlı mekanlarından
gün bazlı seyahat planı oluştur.

Kurallar:
- Sabah: cafe/kahvaltı, Öğle: müze/kültür/shopping, Akşam: restoran/bar
- Aynı bölgedeki mekanları aynı güne grupla (proximity optimization)
- Çalışma saatlerini kontrol et (varsa)
- Her gün max 4-5 mekan (yorucu olmasın)
- Eksik slotları yeni önerilerle doldur (opsiyonel)

Kullanıcının İstanbul'daki mekanları:
{places_json}

Süre: 3 gün
```

**Output:**
```json
{
  "trip_name": "3 Günlük İstanbul",
  "days": [
    {
      "day": 1,
      "theme": "Tarihi Yarımada",
      "places": [
        { "place_id": "xxx", "time_slot": "morning", "duration_min": 60, "note": "Kahvaltı" },
        { "place_id": "yyy", "time_slot": "midday", "duration_min": 120, "note": "Müze gezisi" },
        { "place_id": null, "suggestion": "Sultanahmet Köftecisi", "reason": "Yürüme mesafesinde, 4.3 puan", "time_slot": "lunch" },
        { "place_id": "zzz", "time_slot": "evening", "duration_min": 90, "note": "Akşam yemeği" }
      ],
      "route_coordinates": [[lng1,lat1], [lng2,lat2], ...]
    }
  ]
}
```

**UI:**
- `/trips/plan` sayfasında başlatma (şehir + gün seçimi)
- Streaming ile plan oluşturma → canlı timeline oluşumu
- Kullanıcı düzenleme: mekan değiştir, sıra değiştir, çıkar/ekle
- "Kaydet" → Trip entity oluştur (F-10)
- Haritada rota görüntüleme (Mapbox Directions)

**Maliyet:** Claude Sonnet: ~$0.02-0.05/plan (mekan sayısına göre).

**Effort:** Yüksek (7-10 gün) — AI plan generation + trip entity + route visualization.

**Impact:** 🔥🔥🔥 — "Killer feature". Premium subscription'ın ana motivasyonu. Rakiplerden güçlü ayrışma.

---

## Group M: Visual Intelligence

### AI-10: Görsel Mekan Tanıma (Vision)

**Kaynak:** Analiz-1 + Analiz-2 (AI-8) — her ikisinde de mevcut

**Ne:** Kullanıcı mekan fotoğrafı yükleyerek (tabela, bina, menü, yemek) mekanın Google'daki kaydını bulma.

**Neden:**
- Bazen kullanıcılar mekanın linkini değil fotoğrafını paylaşıyor
- "Bu mekanın adı neydi?" → fotoğrafa bak → bul
- Seyahatte hızlı kayıt: tabela fotoğrafı çek → mekan otomatik tespit
- "Fotoğrafını çek, gerisini biz halledelim" UX'i

**Çalışma Akışı:**

```
Kullanıcı fotoğraf yükler (AddPlaceDialog'da yeni tab: "From Photo")
  → Claude Vision API
  → Extract: mekan adı, adres/konum ipuçları, tür (restoran/cafe/müze)
  → Extracted bilgi ile Google Places API text search
  → Sonuçlar gösterilir → kullanıcı doğru olanı seçer
  → Normal ekleme akışına devam (ParsedPlaceData + preview)
```

**Vision Prompt:**
```
Bu fotoğrafta bir mekanın tabelası, girişi, menüsü veya iç mekanı var.
Aşağıdaki bilgileri çıkar:
1. Mekan adı (tabeladan oku veya tahmin et)
2. Mekan türü (restoran, cafe, bar, otel, müze, vb.)
3. Konum ipuçları (görünen adres, bölge, ülke ipuçları)
4. Ek notlar (ambiyans, mutfak türü, fiyat seviyesi tahmini)
```

**Teknik Detaylar:**
- Input: base64 encoded image (max 5MB)
- Claude Vision: `claude-3-5-sonnet` veya `claude-3-5-haiku` (vision destekli)
- Confidence threshold: düşükse "Emin değilim, lütfen kontrol edin" uyarısı
- Fallback: Vision başarısız → normal link/search akışına yönlendir

**Maliyet:** Claude Sonnet Vision: ~$0.01/görsel.

**Effort:** Orta (3-5 gün) — Vision API + upload UI + search pipeline entegrasyonu.

**Impact:** 🔥🔥 — "Wow" anı, özellikle seyahat sırasında. Ama kullanım sıklığı düşük olabilir.

---

# PART 3 — PRIORITY MATRIX & ROADMAP

## Impact vs Effort Matrix

```
                        IMPACT
              Low        Medium       High
         ┌──────────┬──────────┬──────────┐
  Low    │          │ F-02     │ AI-01    │
  Effort │          │ F-12     │ AI-05    │
         │          │ AI-03    │ F-06*    │
         │          │ AI-04    │          │
         ├──────────┼──────────┼──────────┤
  Med    │ F-16     │ F-03     │ F-07     │
  Effort │          │ F-04     │ F-08a    │
         │          │ F-09     │ F-11a    │
         │          │ AI-06    │ F-14     │
         │          │ AI-08    │ AI-02    │
         │          │ AI-10    │ F-01     │
         ├──────────┼──────────┼──────────┤
  High   │ F-18     │ F-05     │ F-10     │
  Effort │          │ F-15     │ F-11b    │
         │          │ F-17     │ AI-07    │
         │          │ F-08b    │ AI-09    │
         └──────────┴──────────┴──────────┘

* F-06 dark mode kısmı düşük effort, tam tema sistemi orta effort
```

## Önerilen Roadmap

### Sprint 1 — Quick Wins (1-2 hafta)

| ID | Feature | Effort | Gerekçe |
|----|---------|--------|---------|
| F-02 | Mekan Sıralama | 1-2 gün | Temel UX eksikliği, anında değer |
| F-12 | Export (CSV/JSON) | 2-3 gün | Veri güveni, GDPR, düşük effort |
| AI-01 | Doğal Dil Filtreleme | 2-3 gün | En yüksek "wow" / effort oranı |
| AI-05 | Review Özeti | 2-3 gün | editorialSummary yerine, cache'lenebilir |

**Sprint 1 toplam:** ~8-11 gün. Mevcut altyapıyla tam uyumlu, DB migration gerektirmez (AI-05 hariç, google_data JSONB'ye alan ekleme).

### Sprint 2 — Core Enhancement (2-3 hafta)

| ID | Feature | Effort | Gerekçe |
|----|---------|--------|---------|
| F-06 | Dark Mode + Harita Stil | 5-7 gün | Modern beklenti, gece kullanımı |
| F-07 | Custom Map Markers | 4-5 gün | Harita deneyimini dönüştürür |
| F-14 | İstatistik Dashboard | 3-5 gün | Gamification, retention |
| F-01 | Manuel Mekan Ekleme | 3-5 gün | Google bağımlılığını azaltır |

### Sprint 3 — Social & Organization (3-4 hafta)

| ID | Feature | Effort | Gerekçe |
|----|---------|--------|---------|
| F-11a | Public Read-Only Links | 2-3 gün | Paylaşım = viral büyüme |
| F-09 | Drag & Drop Sıralama | 2-3 gün | Trip Planner prerequisite |
| AI-02 | Mekan Chatbot | 5-7 gün | Diferansiyasyon |
| AI-03 | Akıllı Kategorilendirme | 1-2 gün | Veri kalitesi iyileştirme |
| AI-04 | Etiket Önerisi | 1-2 gün | Organizasyon iyileştirme |

### Sprint 4 — Premium Features (4-6 hafta)

| ID | Feature | Effort | Gerekçe |
|----|---------|--------|---------|
| F-10 | Trip Planner (non-AI) | 7-10 gün | "Plan" katmanı |
| AI-09 | AI Trip Planner | 7-10 gün | F-10 üzerine AI layer |
| AI-07 | Recommendation Engine | 4-5 gün | Discovery katmanı |
| F-11b | Collaborative Lists | 7-10 gün | Sosyal katman |

### Backlog (Önceliklendirme bekliyor)

| ID | Feature | Not |
|----|---------|-----|
| F-03 | Saved Filters | Power user'lar için |
| F-04 | Mekan Karşılaştırma | Nice-to-have |
| F-05 | Quick Add (Voice) | Native app ile daha güçlü |
| F-08 | Proximity + Nearby | Nearby hemen, proximity native app'e |
| F-13 | Duplikat Tespiti | Import sonrası maintenance |
| F-15 | Zengin Notlar / Media | Tiptap + upload |
| F-16 | Aktivite Logu | İstatistiklerle birleştirilebilir |
| F-17 | Bildirimler | Push notification altyapısı |
| F-18 | i18n | Uluslararası büyüme planında |
| AI-06 | Sentiment Analizi | AI-05 üzerine extension |
| AI-08 | Akıllı Import | Import pipeline enhancement |
| AI-10 | Görsel Tanıma | Seyahat UX |

---

# PART 4 — CROSS-CUTTING TECHNICAL CONCERNS

## AI Altyapı Kararları

### API Key Stratejisi

| Yaklaşım | Artı | Eksi | Öneri |
|-----------|------|------|-------|
| **Per-user Anthropic key** | Maliyet kullanıcıda, scalable | UX friction (bir key daha girmek) | Uzun vadede |
| **Server-side tek key** ✅ | Sıfır friction, hemen çalışır | Maliyet sizde | Başlangıç için |
| **Hybrid** | Free tier: server key (limitli), Power: own key | Karmaşıklık | Premium model ile |

**Öneri:** Başlangıçta server-side tek key + aylık limit (50 AI istek free). Premium plan ile sınırsız.

### Maliyet Projeksiyonu (Server-Side Key)

| Feature | Kullanım/Ay (100 aktif kullanıcı) | Maliyet/Ay |
|---------|-----------------------------------|------------|
| AI-01 Doğal dil filtre | 5,000 sorgu | ~$2.50 |
| AI-03 Kategorilendirme | 1,000 mekan | ~$1.00 |
| AI-04 Etiket önerisi | 1,000 mekan | ~$1.00 |
| AI-05 Review özeti | 500 mekan | ~$1.00 |
| AI-06 Sentiment | 300 mekan | ~$0.90 |
| AI-02 Chatbot | 2,000 tur | ~$4.00 |
| AI-09 Trip planner | 200 plan | ~$6.00 |
| AI-10 Vision | 100 görsel | ~$1.00 |
| **TOPLAM** | | **~$17.40/ay** |

100 aktif kullanıcı ile aylık ~$17 — uygulanabilir başlangıç maliyeti.

### Supabase Extension İhtiyaçları

| Extension | Feature | Mevcut mi? |
|-----------|---------|------------|
| `PostGIS` | Konum sorguları | ✅ Aktif |
| `pg_trgm` | Duplikat isim benzerliği (F-13) | ❌ Aktifleştirilmeli |
| `pgvector` | Embedding based recommendation (AI-07 Seviye 2) | ❌ Aktifleştirilmeli |

### Yeni DB Tabloları Özeti

| Tablo | Feature | Kolonlar (özet) |
|-------|---------|-----------------|
| `saved_filters` | F-03 | user_id, name, filter_json |
| `shared_links` | F-11a | user_id, resource_type, resource_id, slug, expires_at |
| `list_shares` | F-11b | list_id, shared_with_user_id, permission |
| `trips` | F-10 | user_id, list_id, name, start_date, end_date |
| `trip_days` | F-10 | trip_id, day_number, date, places (jsonb) |
| `activity_log` | F-16 | user_id, action, resource_type, resource_id, metadata |
| `notifications` | F-17 | user_id, type, title, body, read |

### Mevcut Tablo Değişiklikleri

| Tablo | Değişiklik | Feature |
|-------|-----------|---------|
| `places` | + `source: 'manual_pin' \| 'quick_save'` | F-01, F-05 |
| `places` | + `reservation_date timestamptz` | F-17 |
| `places` | + `notify_on_nearby boolean` | F-08b |
| `profiles` | + `theme_preference text` | F-06 |
| `profiles` | + `map_style text` | F-06 |
| `profiles` | + `preferred_language text` | F-18 |
| `profiles` | + `anthropic_api_key_enc text` | AI altyapı |
| `google_data` JSONB | + `ai_summary text` | AI-05 |
| `google_data` JSONB | + `ai_sentiment jsonb` | AI-06 |
| `api_usage.sku` | + AI SKU tipleri | AI altyapı |

### Yeni API Endpoints Özeti

| Endpoint | Method | Feature |
|----------|--------|---------|
| `/api/places/export` | GET | F-12 |
| `/api/places/duplicates` | GET | F-13 |
| `/api/places/merge` | POST | F-13 |
| `/api/places/nearby` | GET | F-08a |
| `/api/filters` | GET/POST/DELETE | F-03 |
| `/api/stats` | GET | F-14 |
| `/api/shared/[slug]` | GET | F-11a |
| `/api/lists/[id]/reorder` | PATCH | F-09 |
| `/api/trips` | CRUD | F-10 |
| `/api/ai/parse-query` | POST | AI-01 |
| `/api/ai/chat` | POST (stream) | AI-02 |
| `/api/ai/categorize` | POST | AI-03 |
| `/api/ai/suggest-tags` | POST | AI-04 |
| `/api/ai/summarize` | POST | AI-05 |
| `/api/ai/sentiment` | POST | AI-06 |
| `/api/ai/recommend` | GET | AI-07 |
| `/api/ai/plan-trip` | POST | AI-09 |
| `/api/ai/vision` | POST | AI-10 |

---

## Feature Bağımlılık Grafiği

```
F-09 (Drag & Drop) ──→ F-10 (Trip Planner) ──→ AI-09 (AI Trip Planner)
                                                      │
F-06 (Dark Mode) ──→ F-07 (Custom Markers)           │
                                                      │
F-08a (Nearby) ──→ F-08b (Proximity Alerts)          │
                                                      │
F-11a (Public Links) ──→ F-11b (Collaborative Lists) │
                                                      │
AI-01 (NL Filter) ──→ AI-02 (Chatbot) ───────────────┘
                                                      
AI-03 (Kategorize) ──→ AI-08 (Akıllı Import)
AI-04 (Tag Önerisi) ─┘

AI-05 (Review Özeti) ──→ AI-06 (Sentiment Analizi)

AI-07 (Recommendations) ← bağımsız (pgvector opsiyonel)
AI-10 (Vision) ← bağımsız
```

---

> **Sonuç:** Bu doküman 28 benzersiz feature önerisini (18 non-AI + 10 AI) kapsamaktadır.
> Her feature bağımsız implement edilebilir, ancak bağımlılık grafiği optimal sıralamayı gösterir.
> Sprint 1'deki 4 feature (Sıralama + Export + NL Filtre + Review Özeti) toplam ~10 günde
> tamamlanabilir ve uygulamanın algılanan değerini dramatik artırır.
>
> Uzun vadeli vizyon: **Organize → Discover → Plan → Share** döngüsünü tamamlayarak
> Map Organiser'ı "Google Maps saved places replacement"tan "kişisel mekan deneyimi platformu"na
> dönüştürmek.
