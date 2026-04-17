# Map Organiser — Feature Suggestions v3

> **Tarih:** 2026-04-17
> **Branch:** `feat/ai-features`
> **Önceki sürüm:** v2 (bkz. docs klasörü, 14 Nisan 2026)
> **Ana odak:** AI-first feature seti + DataForSEO zengin verisinin tam olarak sömürülmesi + v2-sonrası codebase'in yeni kapasitelerine uygun öneriler
>
> Bu doküman sıfırdan hazırlanmıştır. Ancak v2'deki eski öneriler ve implement edilenler dikkate alınmış; örtüşen öneriler "📎 v2 devamı" etiketiyle işaretlenmiştir.

---

## İçindekiler

```
PART 0 — v2 → v3 Geçiş & Stratejik Çerçeve
  0.1  v2'de Implement Edilenler (kısa özet)
  0.2  v2 Backlog'dan Korunanlar
  0.3  v3 Stratejik Yaklaşım
  0.4  Yeni Temeller: DataForSEO + AI SDK v6

PART 1 — Non-AI Yeni Öneriler (NF-01 → NF-24)
  Grup A — DataForSEO Verisinin Görselleştirilmesi (NF-01 → NF-06)
  Grup B — Trip Planner Evolution (NF-07 → NF-11)
  Grup C — Map & Visualization Innovations (NF-12 → NF-15)
  Grup D — Onboarding & Discovery (NF-16 → NF-18)
  Grup E — Power User Productivity (NF-19 → NF-22)
  Grup F — Platform & PWA (NF-23 → NF-24)

PART 2 — AI Features (maximum detail)
  Grup H — Conversational AI & Natural Language (AI-01 → AI-04)
  Grup I — Smart Enrichment & Categorization (AI-05 → AI-09)
  Grup J — Content Generation & Media Intelligence (AI-10 → AI-15)
  Grup K — Discovery & Recommendation Engine (AI-16 → AI-19)
  Grup L — Trip Intelligence (AI-20 → AI-25)
  Grup M — Visual & Voice (AI-26 → AI-30)
  Grup N — Personalization & Memory (AI-31 → AI-34)
  Grup O — Productivity Automation (AI-35 → AI-38)

PART 3 — AI Altyapı Stratejisi
  3.1  SDK & Provider Seçimi
  3.2  Cost Model & Rate Limits
  3.3  DB Schema Değişiklikleri
  3.4  Caching Stratejisi (DataForSEO + AI)
  3.5  pgvector & Embedding Infrastructure

PART 4 — Priority Matrix & Sprint Roadmap
  4.1  Impact vs Effort matrisi
  4.2  Sprint A → E planlama

PART 5 — v2 Overlap & Cross-Cutting Concerns
  5.1  v2 ↔ v3 eşleştirme tablosu
  5.2  Yeni API endpoints özeti
  5.3  Yeni DB tablo/kolon özeti
  5.4  Yeni dependencies
```

---

# PART 0 — v2 → v3 Geçiş & Stratejik Çerçeve

## 0.1  v2'de Implement Edilenler (2026-04-16 itibarıyla)

v2 dökümanı yayımlandıktan sonra aşağıdaki feature'lar tamamlanmıştır. Bu feature'lar v3'te **tekrar önerilmez**, sadece üzerine inşa edilen yeni özelliklerde referans olarak geçer.

| v2 ID | Feature | Commit | v3'te etkisi |
|-------|---------|--------|--------------|
| — | **DataForSEO Integration** | `5db6f1c`, `8f7db35`, `b84f84b`, `da1f432`, `f3c22ce` | ✅ Tüm yeni öneriler bu veri kaynağını varsayar |
| F-02 | Mekan Sıralama | `a2f9a2d`, `40f82f9` | — |
| F-06 | Dark Mode & Tema Sistemi | `d8b9385`, `f1b97b3` | ✅ Yeni UI önerileri dark variant gerektirir |
| F-07 | Custom Map Markers | `df0b442`, `2ebf161`, `eb6fde3` | ✅ NF-13, NF-14 bu üstyapı üzerinde |
| F-09 | Drag & Drop Liste Sıralama | `28e5cf3` | ✅ Trip planner geliştirmelerinde aynı pattern |
| F-10 | Trip Planner | `8248510`, `82b9e14`, `126dca6` | ✅ Grup B ve AI-20…25 bu üstyapı üzerinde |
| F-11a | Public Sharing Links | `34db641`, `b5774ad`, `9dcf75e`, `4ccfb89` | ✅ NF-18, AI-14 bu üstyapıyı kullanır |
| F-14 | İstatistik Dashboard | `d9f2550` | ✅ AI-34 bu üstyapıyı genişletir |
| — | Batch Import Rewrite | `6d68139` | ✅ AI-07 bu pipeline'a enrichment ekler |
| — | Viewport Place Count | `0f5c7fe`, `086efdf` | — |

## 0.2  v2 Backlog'dan Korunanlar (v3'te hala geçerli)

Aşağıdaki v2 önerileri **hâlâ backlog'dadır** ve v3'te de önceliğini korur. v3'te yeniden tanımlanmamıştır — v2 referansı geçerlidir. Ancak bazıları v3'te yeni önerilerle birleştirilerek güçlendirilmiştir.

| v2 ID | Feature | v3 durumu |
|-------|---------|-----------|
| F-01 | Manuel Mekan Ekleme (drop pin / address search) | Bkz. NF-16'da genişletilmiş versiyon |
| F-03 | Kayıtlı Filtreler (saved filter presets) | Aynen geçerli, NF-21'de bahsediliyor |
| F-04 | Mekan Karşılaştırma (side-by-side) | Bkz. AI-19 (AI-powered karşılaştırma) |
| F-05 | Quick Add (voice & shortcuts) | Bkz. AI-27, AI-28 (voice AI) |
| F-08 | Nearby + Proximity Alerts | Aynen geçerli, NF-17 ile entegre edilebilir |
| F-11b | Collaborative Lists | **Rafa kaldırıldı** (v2'de not edildiği gibi) |
| F-12 | Export (CSV/JSON/GeoJSON/KML) | Aynen geçerli — küçük effort, yüksek değer |
| F-13 | Duplikat Tespiti | Bkz. AI-08 (AI-enhanced versiyon) |
| F-15 | Zengin Notlar & User Media | Aynen geçerli, AI-11 not zenginleştirme ile entegre |
| F-16 | Aktivite Logu | Aynen geçerli, AI-34 ile entegre edilebilir |
| F-17 | Bildirimler & Hatırlatıcılar | Bkz. AI-37 (smart timing) |
| F-18 | i18n | Aynen geçerli; AI-13 (çeviri) ile tamamlayıcı |

## 0.3  v3 Stratejik Yaklaşım

v3'ün **üç ana ekseni** vardır:

1. **AI-first:** Uygulamanın değer önerisini "organizasyon aracı"ndan "intelligent companion"a taşımak. AI 38 alt öneri ile merkezde.
2. **DataForSEO sömürüsü:** `rating_distribution`, `popular_times`, `place_topics`, `attributes`, `people_also_search`, 50+ review vb. zaten gelen ama UI'da kullanılmayan veriyi görünür kılmak. Bu, çoğu AI feature'ın ucuz/güçlü temelidir.
3. **Post-v2 olgunluk:** Trip Planner, Sharing ve Stats gibi yeni üstyapılar üzerinde kullanıcıyı elde tutma (retention) odaklı özellikler.

## 0.4  Yeni Temeller: DataForSEO + AI SDK v6

### 0.4.1  DataForSEO'nun getirdiği "bedava" veri zenginliği

v2 dökümanı yazıldığında bu alanlar UI'da kullanılmıyordu. v3 bu veriyi tam sömürür:

| DataForSEO alanı | Nasıl kullanılır | v3'teki yeri |
|------------------|------------------|--------------|
| `rating_distribution` | 1-5 yıldız bar chart | NF-01 |
| `popular_times` | Yoğunluk heatmap + "iyi zaman" önerisi | NF-02, AI-24 |
| `place_topics` | Otomatik tag kaynağı, tag cloud | NF-03, AI-06 |
| `attributes` | Accessibility/amenity filtreleri | NF-04 |
| `people_also_search` | Recommendation seed veri | NF-05, AI-16 |
| `business_description` | editorialSummary yerine | AI-10'da zenginleştirilir |
| `book_online_url`, `local_business_links` | Action butonları | NF-06 |
| `reviews` (50 adet) | Sentiment & özet için zengin girdi | AI-10, AI-12 |
| `owner_answer` (review'da) | İşletme yanıtı gösterimi | NF-06 |
| Review images | User-generated content galerisi | NF-06 |
| `is_claimed`, `current_status` | Güvenilirlik ve durum badge'leri | NF-04 |

### 0.4.2  Önerilen AI stack

**Birincil SDK:** Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic`)
- Streaming (`streamText`, `streamObject`)
- Structured output (`generateObject`, Zod schema)
- Tool calling (Claude'un native fonksiyonları)
- `useChat()` hook (React)

**Provider stratejisi:**

| Katman | Provider | Neden |
|--------|----------|-------|
| **Birincil LLM** | Anthropic Claude (Sonnet 4.6 + Haiku) | Türkçe kalitesi, tool use, structured output |
| **Gateway** | Vercel AI Gateway (opsiyonel) | Observability, fallback, cost tracking |
| **Embeddings** | Voyage AI (`voyage-3-large`) veya OpenAI `text-embedding-3-small` | pgvector için |
| **Vision** | Claude Sonnet 4.6 (built-in vision) | AI-26, AI-27 |
| **ASR (Speech-to-Text)** | OpenAI Whisper (SDK üzerinden) veya Deepgram | AI-28 |
| **TTS (Text-to-Speech)** | OpenAI TTS veya ElevenLabs | AI-28 (opsiyonel) |

**Kod tabanında mevcut olan üstyapı:**
- ✅ AES-256-GCM key encryption (`api_keys` pattern) → `anthropic_api_key_enc` için hazır
- ✅ `api_usage` SKU tracking → AI SKU'ları eklemek yeterli
- ✅ Server-only API routes pattern
- ✅ Zod schemas (structured output için)
- ❌ `@ai-sdk/*` package'leri yok — eklenmeli
- ❌ `pgvector` extension yok — embedding feature'ları için aktive edilmeli
- ❌ `pg_trgm` extension yok — fuzzy match için aktive edilmeli
- ❌ `/api/ai/*` klasörü yok — sıfırdan kurulacak

---

# PART 1 — NON-AI YENİ ÖNERİLER

## Grup A — DataForSEO Verisinin Görselleştirilmesi

Bu grubun tamamı, **zaten gelen ama UI'da kullanılmayan** DataForSEO veri alanlarını kullanıcıya gösterir. Yeni API çağrısı, yeni maliyet yoktur. Hepsi hızlıca uygulanabilir ve yüksek değer üretir.

---

### NF-01: Rating Distribution Visualization

**Kaynak:** v3 yeni (📎 v2'de yoktu ama DataForSEO analiz dokümanında öngörülmüştü)

**Ne:** Mekan detay sayfasında 1-5 yıldız oy dağılımını bar chart olarak gösterme (Google Play / Amazon tarzı).

**Neden:**
- Tek bir `4.5` sayısı mekanın güçlü/zayıf yönlerini göstermiyor.
- `rating_distribution: { "1": 12, "2": 8, "3": 45, "4": 156, "5": 890 }` verisi zaten `google_data` JSONB'de bulunuyor.
- Kullanıcı "çoğunluk 5 yıldız, ama %5 oranında 1 yıldız var" bilgisini görsel olarak değerlendirebilir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Veri** | `google_data.rating_distribution` (DataForSEO'dan gelir, varsa render et) |
| **Component** | `RatingDistributionBar` — yeni component `src/components/places/rating-distribution-bar.tsx` |
| **Chart** | Recharts `BarChart` (horizontal) veya pure CSS div width — Recharts overhead'i fazla olabilir, CSS tercih edilebilir |
| **UI** | Mekan detay sayfasında rating numarasının altında; 5 satır ("5 ★ ████████████ 890"), her satırda sayı + % bar + oy sayısı |
| **Fallback** | Veri yoksa component hiç render olmaz |

**Effort:** Düşük (1 gün)

**Impact:** 🔥🔥 — Detay sayfasını kalite olarak yükseltir, ek maliyet sıfır.

---

### NF-02: Popular Times Widget

**Kaynak:** v3 yeni

**Ne:** Mekan detay sayfasında gün ve saat bazlı yoğunluk grafiği (Google Maps'teki "popular times" gibi).

**Neden:**
- `popular_times: { monday: [{hour:12, popular_index:85}, ...], ... }` zaten `google_data`'da.
- "Cumartesi 19:00'da çok kalabalık olur mu?" sorusu kullanıcının en büyük planlama ihtiyaçlarından biri.
- AI-24 (Best Time to Visit) bu veriyi AI ile zenginleştirecek, ama önce görsel yeter.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Veri** | `google_data.popular_times` (7 gün × 24 saat = 168 veri noktası) |
| **Component** | `PopularTimesChart` — 7 satır (Pzt-Paz), her satır 24 sütun |
| **Görsel** | Tek gün seçimi: Recharts `BarChart` (saat × popular_index). Hafta özeti: 7 bar grid |
| **Renk skalası** | 0-30: emerald-200, 30-60: emerald-400, 60-85: orange-400, 85-100: red-400 |
| **Interaksyon** | Gün seçici chip'leri (bugün default) + hover'da "Sa 14:00 — yoğunluk %85" tooltip |
| **"Canlı" badge** | `popular_times.current.popular_index` varsa "Şu an: %X yoğun" göstergesi |

**Effort:** Düşük-Orta (1-2 gün)

**Impact:** 🔥🔥🔥 — "Şu an git / sonra git" karar desteği, unique diferansiyasyon.

---

### NF-03: Place Topics Tag Cloud

**Kaynak:** v3 yeni

**Ne:** Mekan detay sayfasında review'lardan çıkarılan anahtar kelimeleri tag cloud / chip listesi olarak gösterme.

**Neden:**
- `place_topics: { "pasta": 45, "service": 38, "atmosphere": 29, ... }` zaten mevcut.
- Kullanıcı "Ne öne çıkıyor?" sorusunu görsel olarak yanıtlar — review okumadan.
- AI-06 bu veriyi otomatik tag önerisi için kullanacak; önce görsel gösterim yeter.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Veri** | `google_data.place_topics` — sayıya göre descending |
| **Görsel** | Chip listesi, font boyutu mention sayısına göre scale (min 12px, max 20px) |
| **Tıklama** | Topic'e tıklama → bu kelimeyi içeren review'lar filtrelenerek gösterilir (reviews section) |
| **Limit** | Top 12 topic |

**Effort:** Düşük (0.5-1 gün)

**Impact:** 🔥🔥 — Okunabilirlik artırır, kullanıcı ne aradığını hızla anlar.

---

### NF-04: Place Attributes & Status Badges

**Kaynak:** v3 yeni

**Ne:** Mekan detayında ikonlu özellik listesi (wifi, wheelchair, outdoor seating, vb.) + işletme durumu badge'i.

**Neden:**
- `attributes: { wheelchair_accessible: true, wifi: true, outdoor_seating: true }` zaten geliyor.
- `is_claimed`, `current_status` ("opened"/"closed"/"temporarily_closed"/"closed_forever") geliyor.
- Accessibility filtreleri (F-08 benzeri) için temel altyapı.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Attribute mapping** | `src/lib/places/attribute-icons.ts` — DataForSEO key → Lucide icon + i18n label |
| **UI** | Grid layout: ikon + label, gri (yok) / yeşil (var) renk kodlu |
| **Status badge** | Temporarily closed → amber, Closed forever → red, Opened → emerald outline |
| **Claimed badge** | `is_claimed === true` → "✓ İşletme tarafından doğrulanmış" chip |
| **Filtreleme** | `PlaceFilters` interface'ine `attributes?: string[]` ekle → `google_data->attributes->>wheelchair = 'true'` query |

**Effort:** Orta (2-3 gün) — UI + filtreleme birleşimi

**Impact:** 🔥🔥🔥 — Erişilebilirlik filtresi niş ama kritik, diğerleri herkes için değerli.

---

### NF-05: "Similar Places" Chip Listesi

**Kaynak:** v3 yeni

**Ne:** Mekan detay sayfasında `people_also_search` verisinden benzer mekan önerileri.

**Neden:**
- `people_also_search: [{title, cid, rating}, ...]` zaten DataForSEO'dan geliyor.
- Kullanıcı mevcut mekanı beğendi → benzerleri keşfetmek ister.
- AI-16 (AI-powered recommendation) bu veriyi seed olarak kullanacak.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Veri** | `google_data.people_also_search` — max 6 öneri |
| **UI** | "Benzer Mekanlar" section: horizontal scroll card grid. Her kart: isim + rating + "Ekle" CTA |
| **Ekleme akışı** | CID ile DataForSEO lookup → preview → kullanıcı onayı → `POST /api/places` |
| **Zaten ekli kontrolü** | CID karşılaştırması → "Eklendi ✓" badge |

**Effort:** Orta (2-3 gün)

**Impact:** 🔥🔥 — Discovery döngüsü başlatır, viral mekan ekleme.

---

### NF-06: Action Buttons + Owner Answer UI

**Kaynak:** v3 yeni

**Ne:** Mekan detayında DataForSEO'nun sağladığı aksiyon linklerini butona dönüştürme + review'ların altında işletme yanıtı gösterme + review fotoğraf galerisi.

**Neden:**
- `book_online_url`, `local_business_links: [{type: "menu", url}, {type: "order", url}]` boşuna bekliyor.
- Review'larda `owner_answer` varsa gösterilmiyor.
- Review fotoğrafları (`images` array) varsa gizli kalıyor.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Action buttons** | `book_online_url` → "📅 Rezervasyon Yap" (primary button). `local_business_links.type` → menu/order/appointment/deliver'a göre etiket + ikon |
| **Owner answer** | Review kartının altında sağa kaykık "✉ İşletme yanıtı: …" — muted bg |
| **Review images** | Review kartında küçük thumbnail grid → tıklanınca lightbox |
| **Local guide badge** | Review author'da `local_guide: true` ise "Local Guide" chip |
| **Helpful votes** | `votes_count > 0` ise "👍 12 kişi faydalı buldu" |

**Effort:** Orta (2-3 gün)

**Impact:** 🔥🔥🔥 — Detay sayfasını Google Maps seviyesine taşır, kullanıcı aksiyona geçebilir.

---

## Grup B — Trip Planner Evolution

F-10 ile tanıttığımız Trip Planner, v3'te bir sonraki seviyeye taşınır.

---

### NF-07: Multi-Modal Routing

**Kaynak:** v3 yeni (📎 v2 "known limitations"de bahsedilmişti — sadece walking mevcut)

**Ne:** Trip detayında walking / driving / cycling / transit rota seçenekleri.

**Neden:**
- Mapbox Directions API tüm profile'ları destekler; şu an sadece `walking` kullanılıyor.
- Uzun günler için driving, bisiklet turları için cycling, şehir içi için transit gereklidir.
- Free tier: 100K/ay (zaten yeterli).

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Schema** | `trip_days.routing_profile text DEFAULT 'walking'` kolonu |
| **API** | `src/lib/trip/directions.ts` → profile parameter eklendi |
| **UI** | Her gün header'ında profile seçici (walking/driving/cycling ikonları) |
| **Fallback** | Transit için tam desteği henüz yok — "Yakında" ibaresi |
| **Cache** | Profile değişiminde Directions API yeniden çağrılır, sonuç day-level cache |

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥 — Uzun mesafeli günler için kritik.

---

### NF-08: Trip Budget Tracking

**Kaynak:** v3 yeni

**Ne:** Mekanlara opsiyonel fiyat/maliyet girme + günlük ve toplam bütçe gösterimi.

**Neden:**
- Seyahat planlama maliyet kontrolü olmadan eksiktir.
- DataForSEO `price_level` verisini baz alarak otomatik tahmin yapılabilir (ör. "$$" → ortalama $25/kişi).

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Schema** | `trip_day_places.cost_estimate numeric`, `trip_day_places.currency text DEFAULT 'USD'` |
| **Default** | `price_level` → tier bazlı ortalama (local config table veya hardcoded) |
| **UI** | Timeline'da her mekan satırının sağında "$25" edit'lenebilir inline |
| **Gün toplamı** | Day header'ında `$95 · 3 mekan` |
| **Trip toplamı** | Trip header'ında `Total: $380 (5 days)` |
| **Kişi sayısı** | `trips.party_size integer DEFAULT 1` → toplamı × party_size |
| **Para birimi dönüşümü** | Opsiyonel, v3.1'de — `trips.display_currency` + FX rate API |

**Effort:** Orta (3-4 gün)

**Impact:** 🔥🔥 — Planlayıcı kullanıcı için ciddi değer.

---

### NF-09: Trip Templates / Starter Plans

**Kaynak:** v3 yeni

**Ne:** Yaygın şehirler için önceden hazırlanmış 3-5 günlük şablon trip'ler (Istanbul, London, Paris, vs.) — kullanıcı "Clone to my trips" ile alabilir.

**Neden:**
- Yeni kullanıcı "Trip Planner'ı nasıl kullanırım?" konusunda kayıp.
- Templates ile anında değer: clone → kendi mekanları ile adapt et.
- Viral potansiyel: Community templates (v3.1'de).

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Schema** | `trip_templates` tablosu: id, name, destination_city, duration_days, places_json (title, lat, lng, day, suggested_time), author, is_featured |
| **Seed data** | Manuel olarak 5-10 popüler şehir için template (Istanbul, Paris, London, Tokyo, NYC) |
| **UI** | Trips sayfasında "Templates" tab → grid (şehir fotoğrafı + başlık + gün) |
| **Clone akışı** | Template seç → tarih gir → AI matcher (AI-20) ile kullanıcı mekanları eşleştirilir → kalan mekanlar "public suggested" olarak eklenir |
| **Sharing** | Public trip paylaşımı (F-11a) ile template'e dönüştürme: "Make this a template" butonu — admin onayıyla |

**Effort:** Orta-Yüksek (4-6 gün) — seed data + UI + clone pipeline

**Impact:** 🔥🔥🔥 — Onboarding aktivasyonunu büyük ölçüde artırır.

---

### NF-10: Trip Photo Album & Journal

**Kaynak:** v3 yeni (📎 F-15'in trip odaklı versiyonu)

**Ne:** Trip'e gün bazlı fotoğraf ve not ekleme → sonra trip "journal"a dönüşür.

**Neden:**
- Trip tamamlandıktan sonra anı arşivi ihtiyacı doğal.
- AI-13 (trip story generator) bu içerikten blog post üretebilir.
- Fotoğraflar F-15'in genel altyapısıyla paylaşılır.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Schema** | `trip_photos` tablosu: id, trip_id, trip_day_id (nullable), place_id (nullable), storage_path, caption, taken_at, lat, lng |
| **Upload** | Supabase Storage `trip-photos/{user_id}/{trip_id}/` bucket |
| **EXIF parsing** | Client-side EXIF reader → taken_at, GPS koordinatları otomatik |
| **UI** | Trip detay sayfasında "Journal" tab → timeline (günlere göre gruplu) |
| **Markdown notes** | Gün ve mekan bazlı markdown notlar (Tiptap) |
| **Auto-match** | EXIF GPS + trip yakın mekanlar → mekana otomatik ata öneri |

**Effort:** Yüksek (6-8 gün)

**Impact:** 🔥🔥 — Uygulamayı "öncesi + sonrası" aracına dönüştürür.

---

### NF-11: Trip Calendar View

**Kaynak:** v3 yeni

**Ne:** Tüm trip'ler ve booked tarihlerin takvim görünümünde (ay/yıl) gösterilmesi.

**Neden:**
- Trip ve booked date'lerin kronolojik tek bir yerde olması çakışma önler.
- "Önümdeki 3 ay" görünümü.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Veri** | `trips.start_date..end_date` + `places.reservation_date` (F-17) |
| **UI** | `/calendar` sayfası — ay görünümü, her gün renkli nokta/çubuk (trip rengi) |
| **Mobile** | List view fallback |
| **Library** | `react-day-picker` veya pure CSS grid (minimal) |
| **Entegrasyon** | Native calendar export: `.ics` dosyası oluşturup indir |

**Effort:** Orta (3-4 gün)

**Impact:** 🔥 — Power user için, casual user'da düşük ilgi.

---

## Grup C — Map & Visualization Innovations

---

### NF-12: Heatmap View

**Kaynak:** v3 yeni

**Ne:** Haritada mekan yoğunluğu heatmap overlay'i (Mapbox `heatmap` layer type).

**Neden:**
- "Hangi bölgelerde mekan topladım?" sorusuna anlık görsel cevap.
- Istanbul'un hangi ilçelerinde yoğunlaşıldığını gösterir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Layer** | Mapbox GL `heatmap` layer, weight: `visit_status === 'favorite'` için 2x |
| **Toggle** | Map sağ üstte "Heatmap" toggle (icon: `flame` veya `radar`) |
| **Kombinasyon** | Heatmap + marker'lar birlikte görünür; zoom seviyesinde heatmap yavaşça fade |
| **Filtreleme** | Mevcut `PlaceFilters` heatmap'i de filtreler |

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥 — "Wow" anı, analitik değer.

---

### NF-13: Category Layer Toggle

**Kaynak:** v3 yeni

**Ne:** Harita üzerinde kategori bazlı layer görünürlük toggle'ı (sadece restoranları göster, sadece otelleri göster).

**Neden:**
- "Yemek yeri ararken müzeler kafa karıştırıyor" ihtiyacı.
- Symbol layer zaten kategoriye göre (F-07) — filtre mantığı kurulması gerekir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | Map sağ üstte kategori chip'leri (ikon + isim) → tıklama toggle görünürlüğü |
| **State** | Layer filter: `["==", ["get", "categoryId"], visibleIds]` |
| **Persistence** | localStorage |
| **"All / None"** | Hızlı toggle butonları |

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥 — Günlük kullanımda büyük fark yaratır.

---

### NF-14: Map Drawing Tools & Area Selection

**Kaynak:** v3 yeni

**Ne:** Haritada polygon/dikdörtgen çizme → çizilen alan içindeki mekanları toplu seç.

**Neden:**
- Bulk actions için area-based seçim.
- "Kadıköy'deki tüm mekanlarıma tag ekle" senaryosu.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Library** | `mapbox-gl-draw` (resmi Mapbox plugin) |
| **UI** | Map toolbar: rectangle + polygon tool |
| **Seçim** | Turf.js `booleanPointInPolygon` — tüm mekanları filtrele |
| **Bulk action** | Seçilenler mevcut `BulkActionBar`'a beslenir |

**Effort:** Orta (3-4 gün) — yeni dependency + UX polish

**Impact:** 🔥🔥 — Power user için büyük produktivite artışı.

---

### NF-15: Map Cluster Improvements

**Kaynak:** v3 yeni

**Ne:** Cluster'ların kategori bazlı renk karışımı ile gösterimi (mevcut: mono emerald) + cluster tıklamasında "spiderfy" davranışı.

**Neden:**
- Mevcut cluster'lar kategori bilgisini kaybediyor.
- Spiderfy: aynı koordinat civarındaki mekanları ayrıştırarak gösterme.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Cluster color** | `cluster-color`: `["step", ["get", "dominant_category_color"], "#059669", ...]` veya donut ring rendering |
| **Spiderfy** | `mapbox-gl-spiderfy` community plugin veya custom: cluster tıklanınca 8 yönde expand |
| **Cluster count** | Mevcut cluster count text korunur |

**Effort:** Orta (2-3 gün)

**Impact:** 🔥 — Güzel UX detayı, niche.

---

## Grup D — Onboarding & Discovery

---

### NF-16: Onboarding Wizard (İlk Kurulum)

**Kaynak:** v3 yeni (📎 F-01 ile entegre — drop pin/address search onboarding'in parçası)

**Ne:** İlk giriş sonrası 4-5 adımlı interaktif tutorial: "İlk mekanını ekle, kategoriye ata, listeye koy."

**Neden:**
- Şu anda kullanıcı login → boş harita → ne yapacağını bilmiyor.
- "Empty state" paradoksu: uygulama değerli oldukça data gerekir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | İlk login + `places.count === 0` |
| **Adımlar** | (1) "Google Maps linki yapıştır" demo → (2) Kategori ataması → (3) "Want to Go" status → (4) Liste oluştur → (5) "Haritada gör" |
| **Skip** | Her adımda skip, "Later" butonu |
| **Gamification** | Adım tamamlandıkça progress bar + toast |
| **UI** | Tooltip-based (driver.js benzeri) veya full-screen overlay karma |
| **DB** | `profiles.onboarding_completed boolean DEFAULT false` |

**Effort:** Orta (3-5 gün)

**Impact:** 🔥🔥🔥 — Conversion rate için kritik, retention'a büyük etki.

---

### NF-17: Nearby Places Filter (v2 F-08'in adaptasyonu)

**Kaynak:** 📎 v2 devamı (F-08a)

**Ne:** v2'de tanımlanan ancak henüz implement edilmemiş olan "Bana 2km içindeki mekanlarımı göster" filtresi.

**Özet:** PostGIS `ST_DWithin` ile geolocate entegrasyonu. v2'deki tanım aynen geçerli. Detay için `feature-suggestions_v2.md#F-08` referans.

**v3'te ek:** Nearby toggle aktifken map viewport'u otomatik user konumuna ortala + mesafe slider (500m → 10km).

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥🔥

---

### NF-18: Single Place Sharing

**Kaynak:** v3 yeni (📎 F-11a'nın eksik tamamlaması)

**Ne:** F-11a şu an sadece liste ve trip paylaşıyor — tek bir mekan paylaşımı yok.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Schema** | `shared_links.resource_type` zaten `'list'` veya `'trip'` — `'place'` eklenir |
| **UI** | Place detail sayfasında "Share" butonu |
| **Public page** | `/shared/[slug]` zaten yapılabilir — place rendering eklenir |
| **Save to account** | Login'li kullanıcı için "Add to my places" |

**Effort:** Düşük (1 gün) — mevcut altyapı üzerinde çok küçük ek

**Impact:** 🔥🔥 — Viral büyüme kanalı, tek mekan paylaşmak daha yaygın ihtiyaç.

---

## Grup E — Power User Productivity

---

### NF-19: Bulk Edit

**Kaynak:** v3 yeni

**Ne:** Birden fazla mekanı seçip kategori, tag, visit status, list ataması tek seferde değiştirme.

**Neden:**
- Mevcut bulk sadece delete destekliyor.
- Import sonrası toplu tag/list düzenleme sık ihtiyaç.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | `BulkActionBar`'a "Edit" dropdown: Change category, Add tags, Change status, Add to list |
| **API** | `PATCH /api/places/bulk` — `{ids, changes: {category_id?, tag_ids_add?, tag_ids_remove?, visit_status?, list_ids_add?}}` |
| **Optimistic update** | TanStack Query mutate |

**Effort:** Orta (2-3 gün)

**Impact:** 🔥🔥🔥 — Import sonrası QoL için kritik.

---

### NF-20: Quick Filter Chips (Header)

**Kaynak:** v3 yeni

**Ne:** Header'da sabit hızlı filtre chip'leri: "Want to Go", "Favorites", "Visited This Month", "This City".

**Neden:**
- Mevcut filtre 9 parametre, her biri dropdown açmayı gerektiriyor.
- Power user %80 zaman 3-4 filtre kombinasyonunu kullanır.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | Filter panel üstünde horizontal scroll chip listesi |
| **Preset'ler** | 6 default: Want to Go, Favorites, Visited, Booked, This Week Added, Nearby |
| **User presets** | F-03 ile entegre — kullanıcı kendi preset'ini chip'e dönüştürebilir |

**Effort:** Düşük (1-2 gün)

**Impact:** 🔥🔥

---

### NF-21: Saved Filter Presets (F-03'ün implementasyonu)

**Kaynak:** 📎 v2 devamı (F-03)

**Özet:** v2'deki F-03 tanımı aynen geçerli. UI'yı Quick Filter Chips (NF-20) ile birleştir.

**v3'te ek:** `saved_filters.icon` kolonu (chip'te ikon göstermek için).

**Effort:** Orta (2-3 gün)

**Impact:** 🔥🔥

---

### NF-22: Export (F-12'nin implementasyonu)

**Kaynak:** 📎 v2 devamı (F-12)

**Özet:** v2'deki F-12 tanımı aynen geçerli. CSV / JSON / GeoJSON / KML formatları. GDPR uyumu için kritik.

**v3'te ek:**
- Trip export: tek bir trip için JSON/KML (Google Earth'e import edilebilir)
- "Full backup" export: tüm places + lists + trips + tags zip dosyası

**Effort:** Düşük-Orta (2-4 gün)

**Impact:** 🔥🔥🔥

---

## Grup F — Platform & PWA

---

### NF-23: Enhanced PWA (Install Prompt, Offline Maps, Push)

**Kaynak:** v3 yeni (📎 F-17 push notification burada entegre)

**Alt bileşenler:**

**a) Install Prompt Management:**
- `beforeinstallprompt` event yakalama
- Custom install button (settings veya banner)
- iOS için manuel talimat modal'ı

**b) Offline Maps (Mapbox offline):**
- Kullanıcı "bu şehri offline indir" butonu
- Mapbox OfflineManager API (sadece native SDK'da tam destek — web'de limited)
- **Gerçekçi yaklaşım:** Sadece mekan verileri + kategori cache, harita tile'ları değil. IndexedDB üzerinden.

**c) Push Notifications (F-17 implementasyonu):**
- Web Push API + VAPID keys
- Service worker handler
- Supabase Edge Function cron → notification trigger
- Permission flow UX

**d) Share Target Enhancement:**
- Mevcut share target Google Maps link alıyor; artık resim + metni de alıp parse edebilir (AI-26 ile entegre)

**Effort:** Yüksek (6-9 gün)

**Impact:** 🔥🔥🔥 — PWA'yı native-app seviyesine taşır.

---

### NF-24: Browser Extension (Chrome/Edge/Firefox)

**Kaynak:** v3 yeni

**Ne:** Tarayıcıdan Google Maps sayfasındayken tek tık ile mekanı Map Organiser'a ekleyen browser extension.

**Neden:**
- PWA share target sadece mobilde güçlü.
- Desktop kullanıcılar Google Maps'te gezerken link kopyalamak zahmetli.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Stack** | WXT (https://wxt.dev) veya Plasmo — cross-browser extension framework |
| **Trigger** | Google Maps page detection → floating "+ Add to Map Organiser" button |
| **Auth** | OAuth akışı (Supabase session transfer) |
| **API** | Mevcut `POST /api/places/parse-link` kullanılır |

**Effort:** Yüksek (7-10 gün) — ayrı bir dağıtım kanalı

**Impact:** 🔥🔥 — Desktop kullanıcısı için büyük değer, ayrı store review süreçleri.

---

# PART 2 — AI FEATURES (Maximum Detail)

> **Ortak mimari kararlar:**
> - **SDK:** Vercel AI SDK v6 (`ai@^6`, `@ai-sdk/anthropic@^1`)
> - **Birincil LLM:** Anthropic Claude
>   - **Haiku** (claude-haiku-4.6): düşük maliyet, hızlı — günlük işlemler
>   - **Sonnet** (claude-sonnet-4.6): karmaşık reasoning — trip planner, chat
>   - **Opus** (opus-4.6): en karmaşık + uzun context — yıl sonu özet gibi batch
> - **Cache:** AI sonuçları `google_data.ai_*` prefix'li alanlara veya yeni `ai_cache` tablosuna cache'lenir
> - **Structured output:** Zod schema + `generateText({ output: Output.object({ schema }) })` (AI SDK v6 pattern — `generateObject` deprecated)
> - **Streaming:** `streamText()` + `toUIMessageStreamResponse()` (v6 — `toAIStreamResponse` deprecated)
> - **API key stratejisi:** Başlangıçta server-side tek key, kullanıcı bazlı aylık kota (free: 30, premium: sınırsız). Premium'da "Bring Your Own Key" opsiyonu (mevcut encryption pattern).
> - **Cost tracking:** `api_usage` tablosu genişletilir; her AI isteği token input/output + SKU kaydeder
> - **Fallback:** AI başarısız → mevcut rule-based / DataForSEO verisi devam eder
> - **Rate limit:** Upstash Ratelimit (IP + user_id bazlı) — Vercel Marketplace'ten Redis seçimi

---

## Grup H — Conversational AI & Natural Language

---

### AI-01: Doğal Dil ile Filtreleme & Sorgulama

**Kaynak:** 📎 v2 devamı (AI-01, implement edilmedi)

**v2 tanımı aynen geçerli.** v3'te **iki önemli ek** yapılır:

#### v3 Ekleri:

**a) DataForSEO attribute'larıyla genişletilmiş filtre grameri:**

v2'de `PlaceFilters` ile sınırlıydı. v3'te artık:

| Kullanıcı ifadesi | Tanınan filtre |
|-------------------|----------------|
| "wheelchair accessible olan kafeler" | `attributes: ["wheelchair_accessible"], category: cafe` |
| "wifi olan restoranlar" | `attributes: ["wifi"]` |
| "açık havada oturulabilen yerler" | `attributes: ["outdoor_seating"]` |
| "şu an açık olan mekanlar" | `opening_status: "open_now"` — DataForSEO current_status |
| "4 yıldızdan fazla olan ve kimse 1 yıldız vermemiş" | `rating_min: 4, rating_distribution_1_max: 0` (yeni filtre parametresi) |

**b) Multi-turn clarification:**

Claude structured output + tool use ile belirsiz sorgularda soru-cevap:
```
User: "iyi kafeler göster"
AI: "Hangi şehir için? (şu an İstanbul ve Londra'da mekanlarınız var)"
User: "İstanbul"
AI: → {city: "Istanbul", category_ids: [cafe_uuid], sort: "rating_desc"}
```

#### Teknik (v3 spec):

```typescript
// src/app/api/ai/parse-query/route.ts
// AI SDK v6 pattern: generateText + Output.object (generateObject deprecated)
import { generateText, Output } from 'ai';
import { z } from 'zod';

const PlaceFiltersSchema = z.object({
  country: z.string().optional(),
  city: z.string().optional(),
  category_ids: z.array(z.string().uuid()).optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  visit_status: z.enum(['want_to_go', 'booked', 'visited', 'favorite']).optional(),
  rating_min: z.number().min(1).max(5).optional(),
  attributes: z.array(z.string()).optional(),
  opening_status: z.enum(['open_now', 'opens_today']).optional(),
  created_after: z.string().datetime().optional(),
  search: z.string().optional(),
  sort: z.enum(['name_asc','name_desc','rating_desc','newest','oldest']).optional(),
  needs_clarification: z.string().optional(), // "İstanbul mı Londra mı?" gibi
});

const result = await generateText({
  model: 'anthropic/claude-haiku-4.6', // AI Gateway model slug
  output: Output.object({ schema: PlaceFiltersSchema }),
  system: `Sen kullanıcının mekan arşivi için bir filtre asistanısın.
Kategoriler: ${JSON.stringify(userCategories)}
Etiketler: ${JSON.stringify(userTags)}
Şehirler: ${JSON.stringify(userCities)}
Attributes: ${JSON.stringify(supportedAttributes)}`,
  prompt: userQuery,
});

// result.output is typed as PlaceFilters
const filters = result.output;
```

> Not: Gerçek model ID'leri kullanmadan önce AI Gateway'den güncel liste çekilmeli:
> `curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/"))] | .[].id'`

**Maliyet:** Haiku ~$0.0005/sorgu
**Effort:** Düşük-Orta (3-4 gün — v3'teki ekler dahil)
**Impact:** 🔥🔥🔥

---

### AI-02: Conversational Discovery Chatbot

**Kaynak:** 📎 v2 devamı (AI-02, implement edilmedi)

**v2 tanımı temel alınır,** v3'te **önemli genişletmeler:**

#### v3 Ekleri:

**a) Tool use ile zengin araç seti:**

v2'de sadece `search_places` tool'u vardı. v3'te Claude'un kullanabileceği araçlar:

| Tool | Açıklama |
|------|----------|
| `search_places(filters)` | Mevcut filter API'yi çağır |
| `get_place_details(place_id)` | Tek mekan detayını (rating, popular_times, topics) döner |
| `get_nearby_places(lat, lng, radius)` | PostGIS nearby |
| `compare_places(ids)` | 2-4 mekan yan yana veri döner |
| `create_list(name, place_ids)` | Yeni liste oluştur |
| `add_to_list(list_id, place_ids)` | Listeye ekle |
| `create_trip(city, days)` | Trip başlat (AI-20 ile entegre) |
| `web_search(query)` | Claude built-in web search — şehir hakkında genel bilgi için |

**b) Memory & context yönetimi:**

v2'de son 10 mesaj context'teydi. v3'te:
- **Session memory:** Tüm chat history mesaj bazlı
- **Long-term memory:** `chat_memories` tablosu — kullanıcının belirttiği tercihler ("vegan yerim", "yürüme mesafesi kısa sev")
- **Summarization:** 20+ tur olduğunda eski mesajlar özetlenir (Haiku ile ucuz)

**c) Streaming + inline UI:**

```typescript
// v6 pattern: typed tool parts (tool-{toolName}) with state check
// Alternatif: isToolUIPart(part) catch-all helper kullanılabilir.
message.parts.map((part) => {
  if (part.type === 'tool-search_places' && part.state === 'output-available') {
    return <PlaceCardsInChat places={part.output} />;
  }
  if (part.type === 'text') return part.text;
});
```

**d) Voice mode (AI-28 ile entegre):**

Mic butonu → Whisper transcription → chat input → TTS playback.

#### Teknik Detay:

```typescript
// src/app/api/ai/chat/route.ts
// AI SDK v6: stopWhen + stepCountIs (maxSteps deprecated)
// AI SDK v6: toUIMessageStreamResponse (toAIStreamResponse deprecated)
import { streamText, tool, stepCountIs, convertToModelMessages } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: 'anthropic/claude-sonnet-4.6', // AI Gateway model slug
    system: buildSystemPrompt(user, profile, memories),
    messages: convertToModelMessages(messages),
    tools: {
      search_places: tool({ inputSchema: /* z.object({...}) */, execute: async () => { /* ... */ } }),
      get_place_details: tool({ inputSchema: /* ... */, execute: async () => { /* ... */ } }),
      create_list: tool({ inputSchema: /* ... */, execute: async () => { /* ... */ } }),
      // ...
    },
    stopWhen: stepCountIs(5), // tool calls arası iterasyon
  });

  return result.toUIMessageStreamResponse();
}
```

**Client:**
```typescript
// AI SDK v6: manual input state + DefaultChatTransport + sendMessage
// Not: v6'da input state yönetimi useChat'ten çıkarıldı — useState + sendMessage({ text }) ile yönetilir.
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export function ChatBox() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/ai/chat' }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <form onSubmit={onSubmit}>
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button type="submit" disabled={status === 'streaming'}>Send</button>
    </form>
  );
}
```

**Maliyet:** Sonnet ~$0.015-0.03/tur (tool use + uzun context)
**Effort:** Yüksek (7-10 gün — tool use + memory + UI)
**Impact:** 🔥🔥🔥 — Uygulamayı intelligent companion'a dönüştürür.

---

### AI-03: Voice Conversation Mode

**Kaynak:** v3 yeni (📎 F-05 quick add voice'un evrimi)

**Ne:** AI-02 chatbot'un sesli modu. Tap-to-talk → konuş → cevap oku.

**Neden:**
- Yürürken/araba kullanırken hands-free ihtiyaç.
- Trip içinde "Buraya en yakın restoran?" soru sorma akışı.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **ASR** | OpenAI Whisper API veya Deepgram Nova-2 (streaming) |
| **LLM** | AI-02 chatbot pipeline'ı aynen |
| **TTS** | OpenAI TTS (`tts-1-hd`) veya ElevenLabs (daha doğal ama pahalı) |
| **UI** | Floating mic button, listening/speaking state animasyonu |
| **Browser alternatifi** | Web Speech API (SpeechRecognition + SpeechSynthesis) — ücretsiz, tarayıcı destekli (Chrome/Safari), kalite düşük |
| **Interrupt** | Kullanıcı konuştuğunda TTS'i durdur |

**Maliyet:** Whisper $0.006/dk + TTS $15/1M karakter + LLM ~$0.02/tur = **~$0.04/konuşma turu**

**Effort:** Yüksek (6-8 gün)
**Impact:** 🔥🔥 — Niche ama premium, hands-free trip kullanımı için değerli.

---

### AI-04: Conversational Trip Editor

**Kaynak:** v3 yeni

**Ne:** Trip detay sayfasında "Day 2'yi daha chill yap" / "Bu mekanı sil, yerine sahil ekle" gibi doğal dil komutlarıyla düzenleme.

**Neden:**
- Mevcut trip editing drag-drop ile manuel — çok tıklama gerekir.
- Konuşma modelinde "şunu şöyle yap" en doğal.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | Trip detay sayfasında "✨ Ask AI" floating panel |
| **LLM** | Sonnet + tool use: `move_place`, `remove_place`, `add_place`, `swap_days`, `change_theme_for_day` |
| **Context** | Trip'in tam JSON'ı prompt context'te |
| **Confirmation** | AI değişiklikleri önce "preview" ile gösterir → kullanıcı onayı → commit |
| **Undo** | Son 10 değişikliğin history'si + undo butonu |

**Örnekler:**
- "Day 3'ü 1 saat kısalt" → last place'ı çıkar
- "Akşam planı azar, öğle ekle" → restoran-bar dengesi
- "İstanbul'da daha çok Osmanlı tarihi yerleri ekle" → AI-16 benzer mekan önerir

**Maliyet:** Sonnet ~$0.02/tur
**Effort:** Orta-Yüksek (5-7 gün)
**Impact:** 🔥🔥🔥 — Trip planner'ı 10x kullanılabilir yapar.

---

## Grup I — Smart Enrichment & Categorization

---

### AI-05: Akıllı Kategorizasyon (LLM-Enhanced)

**Kaynak:** 📎 v2 devamı (v2 AI-03, implement edilmedi)

**v2 tanımı aynen geçerli.** v3'te **iki ek:**

**a) DataForSEO `category` + `category_ids` + `place_topics` prompt context'e eklenir** → accuracy %90+'a çıkar.

**b) Batch re-categorization job (AI-09 ile birleşir):**
- Settings > Categories > "AI re-categorize 'Other' category" butonu
- Background job: tüm "Other" mekanları AI ile yeniden kategorize et
- Kullanıcı onay ekranı: değişiklikleri review et

**Maliyet:** Haiku ~$0.001/mekan
**Effort:** Düşük (1-2 gün) — v2'den aynı
**Impact:** 🔥🔥

---

### AI-06: Otomatik Etiket Önerisi (DataForSEO + LLM Hybrid)

**Kaynak:** 📎 v2 devamı (v2 AI-04, implement edilmedi)

**v3'te önemli değişiklik:** DataForSEO `place_topics` + `attributes` verisi ile **LLM'e bile gerek kalmadan** otomatik tag önerisi yapılabilir.

#### İki aşamalı yaklaşım:

**Aşama 1 — Zero-cost DataForSEO extraction (LLM'siz):**
```typescript
// src/lib/places/extract-tags-from-data.ts
function extractTagsFromGoogleData(place: Place, userTags: Tag[]): string[] {
  const suggestions: string[] = [];

  // place_topics'tan (tutarlılık için user tag'leriyle eşleştir)
  Object.keys(place.google_data.place_topics ?? {}).forEach(topic => {
    const match = userTags.find(t => t.name.toLowerCase() === topic.toLowerCase());
    if (match) suggestions.push(match.id);
  });

  // attributes'tan
  if (place.google_data.attributes?.wheelchair_accessible) suggestions.push('accessible');
  if (place.google_data.attributes?.outdoor_seating) suggestions.push('outdoor');
  if (place.google_data.attributes?.wifi) suggestions.push('wifi');
  if (place.google_data.attributes?.live_music) suggestions.push('live-music');

  return suggestions;
}
```

**Aşama 2 — LLM fallback (Aşama 1 yetersizse):**
- Kullanıcı tag'leri arasında eşleşme yoksa → Haiku ile öner
- Yeni tag önerisi ise kullanıcıya "Bu tag'i oluşturayım mı?" sorusu

**Maliyet:** Aşama 1 ücretsiz, Aşama 2 Haiku ~$0.001/mekan
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥🔥🔥 — Ücretsiz değer katmanı.

---

### AI-07: Akıllı Import Enrichment

**Kaynak:** 📎 v2 devamı (v2 AI-08, implement edilmedi)

**v2 tanımı aynen geçerli.** v3'te genişletmeler:

**a) Failed match resolution (v2'deki ana odak):**
- Google/DataForSEO bulamadı → CSV not alanından + isimden AI ile tahmin → daha iyi query oluştur → tekrar dene

**b) Import sırasında otomatik kategori + tag ataması:**
- AI-05 + AI-06 pipeline'ı import-batch'e entegre
- Her mekan için Haiku ile tek call (kategori + tag + opsiyonel açıklama düzeltmesi)

**c) Duplicate detection (AI-08 ile entegre):**
- Her import sırasında yeni mekan mevcutlarla karşılaştırılır
- AI confidence > 0.8 ise "Bu mekan zaten kayıtlı, birleştir?" önerisi

**Maliyet:** Haiku ~$0.003/mekan (kategori+tag+duplicate check combined)
**Effort:** Orta (4-5 gün)
**Impact:** 🔥🔥 — Import kalitesini dramatik artırır.

---

### AI-08: AI-Enhanced Duplicate Detection & Merge

**Kaynak:** v3 yeni (📎 v2 F-13'ün AI versiyonu)

**v2 F-13'te rule-based yaklaşım vardı (pg_trgm, proximity).** v3'te hibrit:

**Katmanlı tespit:**

| Katman | Yöntem | Hassasiyet | Maliyet |
|--------|--------|------------|---------|
| **1. Exact match** | `google_place_id` | %100 | Zero |
| **2. Proximity + name similarity** | `ST_DWithin 100m` + `pg_trgm similarity > 0.6` | Yüksek | Zero (DB only) |
| **3. AI verification** | Candidate çiftleri Claude Haiku'ya gönder → "Aynı mı?" yes/no + confidence | En yüksek | ~$0.001/çift |

**AI merge akışı:**
- AI önerilen merge'leri UI'da gösterir
- Kullanıcı onayı → AI merge planı önerir:
  - "Bu alanları birleştir" (tag'ler union, notlar concat)
  - "Hangi rating'i koruyalım?" (daha zengin olanı seç)
  - "Hangi fotoğrafları koruyalım?"
- `POST /api/places/merge` — primary_id + secondary_id + merge_plan

**Maliyet:** Haiku ~$0.002 / 100 mekan (rule-based filtre sonrası ~10 çift kalırsa)
**Effort:** Orta (4-5 gün)
**Impact:** 🔥🔥

---

### AI-09: AI Bulk Re-categorization Job

**Kaynak:** v3 yeni

**Ne:** "Settings > Categories" altında "Tüm 'Other' kategorideki mekanları AI ile yeniden kategorize et" butonu.

**Neden:**
- Import sonrası "Other" oranı %15-20 olabilir.
- Kullanıcı tek tek düzeltmek yerine batch job ile çözebilir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | Settings > Categories > "Recategorize Other" butonu |
| **Background** | Vercel Queue / Cron / Supabase Edge Function — uzun işleri async yap |
| **LLM** | Haiku, 10'arlı batch |
| **UI** | Progress modal: "50/200 mekan işlendi" |
| **Review** | Tamamlandıktan sonra "Review changes" ekranı — kullanıcı tek tek onay/red |
| **Rollback** | Her değişiklik activity_log'a (F-16) yazılır, geri alınabilir |

**Maliyet:** Haiku ~$0.001/mekan → 200 mekan = $0.20
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥

---

## Grup J — Content Generation & Media Intelligence

---

### AI-10: Mekan Özeti & Review Sentezi

**Kaynak:** 📎 v2 devamı (v2 AI-05, implement edilmedi)

**v2 tanımı baz.** v3'te **dramatik iyileşme:**

**v2'de:** 10 review input → kısa özet. Google Places Enterprise sadece 5 review veriyordu.
**v3'te:** DataForSEO sayesinde **50 review input → çok daha zengin özet**, aynı maliyet.

#### v3 structured output:

```typescript
const SummarySchema = z.object({
  tldr: z.string().describe('2-3 cümle genel özet'),
  highlights: z.array(z.object({
    theme: z.enum(['food','service','atmosphere','value','location','cleanliness']),
    sentiment: z.enum(['positive','neutral','negative']),
    evidence: z.string().describe('Review'lardan örnek quote'lar'),
  })),
  best_for: z.array(z.string()).describe('e.g., "romantic dinner", "family brunch"'),
  avoid_if: z.array(z.string()).optional().describe('olumsuz pattern'),
  language: z.string(),
});
```

#### Cache stratejisi:

| Senaryo | Cache Davranışı |
|---------|-----------------|
| İlk oluşturma | `google_data.ai_summary` → 90 gün valid |
| Reviews refresh | Yeniden üret |
| Dil değişimi | Her dil için ayrı cache (`ai_summary_tr`, `ai_summary_en`) |

**Maliyet:** Haiku ~$0.003/mekan (50 review input)
**Effort:** Düşük-Orta (3-4 gün — v2'den aynı ama richer output)
**Impact:** 🔥🔥🔥

---

### AI-11: AI Note Polishing

**Kaynak:** v3 yeni

**Ne:** Kullanıcı mekan notunu yazınca "✨ Enhance" butonu → AI notu genişletir/zenginleştirir/dilbilgisi düzeltir.

**Neden:**
- "beğendim, pahalı" gibi kısa notlar → daha aranabilir, okunabilir metne dönüşür.
- AI-16 recommendation için note quality matters.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | Tiptap editor yanında "✨ AI Enhance" butonu |
| **Modes** | "Expand" (genişlet), "Fix grammar", "Summarize", "Translate" |
| **LLM** | Haiku, streaming |
| **Opt-in** | Her çağrı kullanıcı onayı |

**Maliyet:** Haiku ~$0.0005/not
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥

---

### AI-12: Review Sentiment & Theme Analysis

**Kaynak:** 📎 v2 devamı (v2 AI-06)

**v3'te çok daha güçlü:** DataForSEO `rating_distribution` + 50 review + `place_topics` üçlüsü ile:

**a) Rule-based baz çıkar (ücretsiz):**
```typescript
const themeBase = {
  food: { score: normalize(place_topics.food + topics.taste - topics.bad_food), mentions: 45 },
  service: { score: ..., mentions: 38 },
  // ...
};
```

**b) AI nuance layer (Haiku):**
- 50 review text'i → tema bazlı pozitif/negatif quote'lar
- Claude'un nuance yakalayabildiği ironi, bağlam vb. için kullanılır

**UI:**
- Horizontal theme bar'lar (AI-10 ile birleştirilebilir)
- "Show examples" → ilgili review quote'ları expand

**Maliyet:** Haiku ~$0.003/mekan
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥

---

### AI-13: Review Translation (Reviews i18n)

**Kaynak:** v3 yeni

**Ne:** DataForSEO reviews'ta orijinal dil (Japonca, Almanca, vs.) metinleri kullanıcının diline AI ile çeviri.

**Neden:**
- Yurt dışında yerel yorumlar okunmadan kalıyor.
- Google Translate widget UX kötü — inline çeviri daha iyi.
- `original_review_text` + `original_language` zaten DataForSEO'dan geliyor.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | Review kartında "Translate" butonu (her orijinal dilde bir kez) |
| **LLM** | Haiku (düşük maliyet, yüksek kalite Türkçe/İngilizce) |
| **Cache** | `ai_cache.resource = 'review'`, key = `review_id + target_lang` |
| **Batch** | "Translate all reviews" → 50 review tek call'da |

**Maliyet:** Haiku ~$0.002/50 review batch
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥🔥

---

### AI-14: AI Share Caption Generator

**Kaynak:** v3 yeni

**Ne:** Liste veya trip paylaşırken AI otomatik başlık + kısa açıklama + hashtag önerir.

**Neden:**
- Paylaşım akışında kullanıcı "ne yazayım?" kararsızlığı yaşar.
- Viral sharing için iyi caption kritik.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Liste/trip JSON (mekanlar, şehir, trip tarih aralığı) |
| **Output** | 3 alternatif caption (farklı ton: casual / informatif / Instagram-friendly) + hashtag listesi |
| **LLM** | Haiku + structured output |
| **UI** | Share modal'ında "Generate captions" → 3 seçenek → kopyala |

**Maliyet:** Haiku ~$0.002/share
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥

---

### AI-15: Trip Story / Blog Post Generator

**Kaynak:** v3 yeni (📎 NF-10 Trip Journal ile entegre)

**Ne:** Trip tamamlandıktan sonra "AI Write Story" butonu → mekan listesi + fotoğraflar + notlar → markdown blog post üretir.

**Neden:**
- Trip sonrası kullanıcı genellikle Instagram/blog post yazmak ister ama emek.
- Uygulama bu değeri ücretsiz verirse "gotta save this trip" motivasyonu güçlenir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Trip + tüm day_places + NF-10 fotoğraflar + notlar |
| **LLM** | Sonnet (uzun, yaratıcı çıktı için) |
| **Structured output** | `{title, intro, day_sections: [{day, title, narrative, highlights, photos[]}], conclusion, hashtags}` |
| **UI** | Trip detay > "Generate Travel Journal" butonu → markdown preview → kopyala veya download (.md) |
| **Customization** | Ton seçimi: professional / casual / humorous / literary |

**Maliyet:** Sonnet ~$0.05-0.10/trip (uzun prompt + uzun output)
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥🔥 — Unique unutulmaz özellik, paylaşım motivasyonu.

---

## Grup K — Discovery & Recommendation Engine

---

### AI-16: Personalized Recommendations (pgvector Hybrid)

**Kaynak:** 📎 v2 devamı (v2 AI-07)

**v3'te tam implementation:** v2'de iki seviye önerildi; v3 her ikisini birleştirir.

#### Mimari:

**1. User profile vector (öğrenilmiş tercih):**
```
User profile embedding = mean(embeddings of places with visit_status='favorite' OR rating=5)
```

**2. Candidate generation (üç kaynak):**

| Kaynak | Açıklama | Maliyet |
|--------|----------|---------|
| **DataForSEO people_also_search** | Kullanıcının favori mekanlarının "people also search" listeleri birleşimi | Zero |
| **Google Nearby Search** | Aktif şehirlerde, kullanıcının kategori tercihiyle | $32/1K, sınırlı kullan |
| **pgvector similarity** | Kullanıcı profile vektörüne en yakın public/community mekanları | Embedding bir kez, query ucuz |

**3. Re-ranking (AI):**
- Candidate'leri Claude Haiku ile re-rank
- Her öneriye "neden öneriyoruz" açıklaması üret

#### Pg Vector Setup:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Place embedding tablosu
CREATE TABLE place_embeddings (
  place_id uuid PRIMARY KEY REFERENCES places ON DELETE CASCADE,
  embedding vector(1024) NOT NULL, -- voyage-3-large: 1024d
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX ON place_embeddings USING ivfflat (embedding vector_cosine_ops);
```

**Embedding content (her mekan için):**
```
{name} | {category} | {tags} | {notes} | {google_data.business_description}
| {place_topics top 5} | {address} | {country}
```

#### Opt-in Community Discovery:

- Kullanıcı opt-in ederse mekanları (anonimleştirilmiş) public recommendation pool'una katılır
- Başka kullanıcılar için recommendation source olur
- Privacy: sadece yapısal veri (isim, konum, kategori), user notes paylaşılmaz

**Maliyet:**
- Embedding: Voyage-3-large ~$0.02/1M token → 1 mekan ~$0.00001 (one-time)
- Re-ranking: Haiku ~$0.005/öneri seti (10 mekan)
- Nearby Search: Seçici kullanım, ayda $1-2/user

**Effort:** Yüksek (8-10 gün) — pgvector setup + pipeline
**Impact:** 🔥🔥🔥 — Discovery katmanı; premium subscription motivasyonu.

---

### AI-17: AI Place Discovery via Web Search

**Kaynak:** v3 yeni

**Ne:** "Barcelona'da en iyi gözlem teraslı rooftop bar'ları öner" tarzı sorgularda Claude'un web search tool'u + Map Organiser pipeline entegrasyonu.

**Neden:**
- Kullanıcı gitmediği bir şehirde araştırma yaparken, AI web'den güncel info çekebilir.
- Bulunanlar doğrudan "want_to_go" olarak eklenebilir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Tool** | Claude web_search (Anthropic'in built-in tool'u) veya Brave Search API entegrasyonu |
| **Pipeline** | Web search → isimler + kısa açıklamalar → her biri için DataForSEO lookup → preview listesi |
| **UI** | AI-02 chat içinde veya dedicated `/discover?query=...` sayfası |
| **Rate limit** | Kullanıcı başı ayda 20 discovery sorgusu (free tier) |

**Maliyet:** Sonnet + web search ~$0.03-0.05/sorgu
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥🔥 — Discovery'nin en güçlü formu.

---

### AI-18: Mood Matcher ("What Should I Do?")

**Kaynak:** v3 yeni

**Ne:** Kullanıcı hali hazır bir mekandayken veya seçim yapamıyorsa "Bugün ne yapsam?" butonu → AI mevcut context'le öneri.

**Context inputs:**
- Mevcut konum (geolocate)
- Hava durumu (OpenWeatherMap API)
- Saat + gün + mevsim
- Kullanıcı tercihleri (AI-31 profile)
- Popular_times (şu an açık/yoğun mu?)

**Örnek prompt akışı:**
```
Şu an: Salı 19:30, İstanbul Kadıköy, yağmurlu
Kullanıcı: "Romantik bir akşam yemeği"
AI: → "3 öneri var:
  1. [Restoran A] — 300m, 4.5★, romantic tag, dinner_for_two atmosphere
  2. [Restoran B] — 500m, 4.8★, rooftop ama yağmurda kapalı olabilir
  3. [Restoran C] — 1.2km, 4.3★, vegan odaklı"
```

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **UI** | FAB "✨" veya chat komutu |
| **Weather API** | OpenWeatherMap (ücretsiz tier 60 calls/dk yeterli) |
| **LLM** | Sonnet (context'i harmanlamak için) |
| **Tools** | search_places + get_nearby |

**Maliyet:** Sonnet ~$0.015/sorgu + Weather ücretsiz
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥🔥

---

### AI-19: AI-Powered Place Comparison

**Kaynak:** v3 yeni (📎 v2 F-04'ün AI versiyonu)

**Ne:** 2-4 mekan seçip "Compare with AI" → yan yana tablo + AI verdict ("Senin için X'i öneririm, çünkü...").

**Neden:**
- v2'deki F-04 sadece veri yan yana. AI verdict decision-making'i hızlandırır.
- DataForSEO rating_distribution + topics + attributes ile derin analiz mümkün.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | 2-4 place + user's preferences (AI-31) |
| **LLM** | Sonnet |
| **Output** | Table + "My pick" + reasoning + tradeoff summary |
| **UI** | Compare sayfası (F-04 baz alınır) + AI verdict card |

**Maliyet:** Sonnet ~$0.03/karşılaştırma
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥

---

## Grup L — Trip Intelligence

---

### AI-20: AI Trip Planner (Full-Featured)

**Kaynak:** 📎 v2 devamı (v2 AI-09, implement edilmedi)

**v2 tanımı baz.** v3'te **çok daha güçlü** çünkü DataForSEO verisi:

| DataForSEO alanı | Planlama katkısı |
|------------------|------------------|
| `popular_times` | "14:00'da git, 19:00 yoğun" |
| `current_status` | Kapalı mekanı plana dahil etme |
| `opening_hours` | Saat kontrolü |
| `category_ids` | Time-slot eşleştirme (cafe sabah, restoran akşam) |
| `place_topics` | "Romantic" plan için topic filter |
| `price_level` | Bütçe uyumu |
| `people_also_search` | Boş slot önerisi |

#### Structured Output:

```typescript
const TripPlanSchema = z.object({
  trip_name: z.string(),
  theme: z.string(),
  days: z.array(z.object({
    day: z.number(),
    theme: z.string(),
    places: z.array(z.object({
      place_id: z.string().uuid().nullable(), // null = AI suggestion, not user's
      suggestion_name: z.string().optional(),
      suggestion_reason: z.string().optional(),
      time_slot: z.enum(['morning','midday','lunch','afternoon','dinner','evening','late']),
      duration_min: z.number(),
      note: z.string(),
    })),
    estimated_cost: z.number(),
    total_walking_km: z.number(),
  })),
  tips: z.array(z.string()),
  pace_rating: z.enum(['relaxed','moderate','packed']),
});
```

**Maliyet:** Sonnet ~$0.05-0.10/plan
**Effort:** Yüksek (8-10 gün)
**Impact:** 🔥🔥🔥 — Killer feature, premium tier motivator.

---

### AI-21: AI Trip Briefing (Pre-Trip)

**Kaynak:** v3 yeni

**Ne:** Trip başlamadan 1 gün önce AI brifing üretir: hava durumu, günün detayları, hatırlatıcılar, backup plan.

**Output:**
```
Yarın Day 1 — Sultanahmet
🌤 Hava: 18°C, parçalı bulutlu
🕒 Rota: 4 mekan, toplam 2.5km yürüyüş

09:00 — Dusty Knuckle Cafe (kahvaltı)
  Not: Şu an pazar sabahı yoğun, 15dk bekleme olabilir.
10:30 — V&A Müzesi
  Not: Bugün saat 11:00'da ücretsiz tur başlıyor — 30dk önce gel.

🎒 Hatırlatıcılar:
  - Müze için pasaport (kimlik kontrolü)
  - Yağmurluk (14:00 sonrası yağış)

💡 Backup planı: Yağmur devam ederse alternatif olarak [nearby museum].
```

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | Supabase Cron → her gün saat 20:00 (kullanıcının timezone'una göre) |
| **Condition** | Yarın başlayacak veya devam eden trip varsa |
| **Content** | Trip data + weather + popular_times |
| **Delivery** | Push notification (NF-23) + email + in-app notification center |
| **Customization** | Kullanıcı günlük / gün öncesi / ikisi seçebilir |

**Maliyet:** Sonnet ~$0.02/brifing
**Effort:** Orta (4-5 gün — cron + delivery)
**Impact:** 🔥🔥🔥

---

### AI-22: Itinerary Critique & Improvement

**Kaynak:** v3 yeni

**Ne:** Mevcut trip'in AI analizi: "Bu plan çok yorucu, Day 3 şöyle düzelt" önerileri.

**Kriterler:**
- Pace (günlük yürüyüş km, mekan sayısı)
- Variety (category balance)
- Timing (popular_times, opening_hours çakışması)
- Logistic (geographic clustering)
- Budget (price_level toplamı)

**Output:**
```json
{
  "score": 7.5,
  "strengths": ["Coğrafi olarak iyi gruplanmış", "Çeşitli kategoriler"],
  "issues": [
    { "severity": "high", "day": 2, "issue": "6 mekan — çok yoğun", "fix": "2 mekan Day 3'e taşı" },
    { "severity": "medium", "day": 3, "issue": "Akşam restoranı 20:00'dan önce kapanıyor", "fix": "X restoranını öner" }
  ],
  "suggestions": ["Dinlenme arası ekle", "Müze günü güne dağıt"]
}
```

**Maliyet:** Sonnet ~$0.02/critique
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥

---

### AI-23: Trip Day Themes Auto-Generator

**Kaynak:** v3 yeni

**Ne:** Mevcut trip_days'e AI otomatik tema atar: "Day 1: Tarihi Yarımada", "Day 2: Boğaz Günü".

**Neden:**
- Trip UI görsel olarak daha keyifli.
- Kullanıcı günleri hatırlaması kolaylaşır.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Trip_day + day_places (isim + kategori + konum) |
| **LLM** | Haiku (kısa çıktı) |
| **Output** | 2-4 kelimelik tema + emoji |
| **Schema** | `trip_days.theme text`, `trip_days.emoji text` |

**Maliyet:** Haiku ~$0.001/gün
**Effort:** Düşük (1 gün)
**Impact:** 🔥

---

### AI-24: Best Time to Visit

**Kaynak:** v3 yeni (📎 NF-02 ile birleşik)

**Ne:** Mekan detayında `popular_times` + `opening_hours` + kullanıcı context'ine göre AI "şu saatte git" önerisi.

**Örnek:**
```
Şu an: Cumartesi 13:00
"Bu restoran hafta sonu öğle saatleri çok yoğun.
Öneri: 14:30 sonrası gelmen veya akşam 19:00 öncesi rezervasyon."
```

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | popular_times + current time + user location |
| **LLM** | Haiku (simple reasoning) |
| **UI** | NF-02 widget'ın altında "✨ AI Öneri" card |
| **Cache** | 1 saat cache (current time changes) |

**Maliyet:** Haiku ~$0.0005/sorgu
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥🔥

---

### AI-25: Multi-City Trip Optimizer

**Kaynak:** v3 yeni

**Ne:** "İstanbul + Kapadokya + Antalya 10 gün" gibi çok şehirli trip'lerde şehir sırası + gün dağılımı + ulaşım önerisi.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Şehir listesi + toplam gün + başlangıç şehri + bütçe (opsiyonel) |
| **LLM** | Sonnet (kompleks optimizasyon) |
| **Output** | Şehir sırası + her şehir için gün sayısı + ulaşım önerisi (uçak/tren/araba) + her şehir için AI-20 plan chain |
| **Integration** | Trip hierarchy: `parent_trip_id` kolonu → multi-city trip'in alt trip'leri |

**Maliyet:** Sonnet ~$0.10-0.20/plan
**Effort:** Yüksek (6-8 gün)
**Impact:** 🔥🔥

---

## Grup M — Visual & Voice

---

### AI-26: Görsel Mekan Tanıma (Vision)

**Kaynak:** 📎 v2 devamı (v2 AI-10)

**v2 tanımı aynen geçerli.** v3'te ek:
- PWA share target'ta fotoğraf paylaşımı → otomatik Vision + add flow
- EXIF GPS coordinates varsa vision + location combined match

**Maliyet:** Sonnet Vision ~$0.01/image
**Effort:** Orta (3-5 gün)
**Impact:** 🔥🔥

---

### AI-27: Photo-to-Place (Food/Landmark Recognition)

**Kaynak:** v3 yeni

**Ne:** AI-26'nın evrimi: Sadece tabela değil, yemek fotoğrafı / manzara / iç mekan fotoğrafından mekan tahmini.

**Örnek:** Ramen fotoğrafı → "Bu muhtemelen Ichiran Shibuya" → Google lookup → preview.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Vision** | Claude Sonnet 4.6 (güçlü visual reasoning) |
| **Ek context** | Kullanıcı konumu (lat/lng), son 5 mekan |
| **Confidence** | Düşükse "3 olası mekan" listesi |
| **Fallback** | Metin bazlı search ile kombine |

**Maliyet:** Sonnet Vision ~$0.015/image (food analysis daha kompleks)
**Effort:** Orta (3-4 gün — AI-26 üzerine)
**Impact:** 🔥🔥

---

### AI-28: Voice Notes (Speech-to-Structured Data)

**Kaynak:** v3 yeni (📎 F-05 voice'un evrimi)

**Ne:** Kullanıcı sesli not kaydeder → Whisper transcribe → AI structured extraction (mekan adı, kategori, rating, note text, tags).

**Örnek:**
```
User (voice): "Geçen gün gittiğim o Japon restoranı Kadıköy'de, adı Sushi Bar,
çok iyiydi, 5 yıldız verebilirim, ama pahalıydı. Tag olarak sushi ve date-spot ekleyelim."

AI extract:
{
  name: "Sushi Bar",
  district: "Kadıköy",
  category: "restaurant" (cuisine: japanese),
  rating: 5,
  notes: "Çok iyiydi, pahalı",
  tags: ["sushi", "date-spot"]
}
```

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **ASR** | Whisper (web-based whisper.cpp on-device veya API) |
| **LLM** | Haiku + structured output |
| **UI** | Mic butonu → real-time transcription → edit → save |
| **Fallback** | Transkripsiyon + manuel edit |

**Maliyet:** Whisper $0.006/dk + Haiku $0.001 = ~$0.01/note
**Effort:** Orta-Yüksek (5-7 gün)
**Impact:** 🔥🔥 — Mobile kullanıcılar için büyük friction azaltma.

---

### AI-29: Map Screenshot Analyzer

**Kaynak:** v3 yeni

**Ne:** Kullanıcı bir harita screenshot'ını (arkadaştan Instagram, blog, Google Maps collection) upload eder → Vision bu mekan marker'larını tanır → hepsini Map Organiser'a ekler.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Image upload |
| **Vision** | Claude Sonnet 4.6 — "Bu haritadaki mekanları, marker'ları ve isimleri listele" |
| **Post-processing** | Her isim için DataForSEO text search → confirmed match |
| **Review** | Kullanıcıya eşleşmeler gösterilir, onaylar |

**Maliyet:** Sonnet Vision ~$0.02/screenshot (multiple markers)
**Effort:** Orta (3-4 gün)
**Impact:** 🔥🔥 — Import path'ini radikal değiştirir.

---

### AI-30: Receipt OCR + Place Match

**Kaynak:** v3 yeni

**Ne:** Kullanıcı fişi fotoğraflar → Vision fiş bilgilerini (restoran adı, tarih, tutar) çıkarır → otomatik mekan eşleşmesi + "visited" olarak işaretleme + NF-08 bütçe güncelleme.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Vision** | Sonnet (OCR + understanding) |
| **Output schema** | `{restaurant_name, address?, date, total_amount, currency, items?}` |
| **Match** | DataForSEO lookup → mevcut mekanla eşleştir |
| **Auto-actions** | visited_at: date, cost_estimate: total_amount, notes'a items eklenir |

**Maliyet:** Sonnet Vision ~$0.015/receipt
**Effort:** Orta (3-5 gün)
**Impact:** 🔥🔥 — Otomatik log keeping, ziyaret history için güçlü.

---

## Grup N — Personalization & Memory

---

### AI-31: Travel Personality Profile

**Kaynak:** v3 yeni

**Ne:** Kullanıcının kullanım pattern'inden AI travel personality oluşturur → tüm AI feature'lar bu profili kullanır.

**Profile özellikleri:**
- Preferred categories (ratio)
- Pace (chill / moderate / packed)
- Budget tier (budget / mid / luxury)
- Cuisine preferences
- Activity style (nature / urban / cultural / nightlife)
- Travel style (solo / couple / family / group)
- Dietary restrictions (if mentioned in notes)

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Generation** | Haftalık cron → kullanıcı mekanları + ratings + notes → AI analiz |
| **Schema** | `user_travel_profiles` tablosu — updated_at, profile_json, version |
| **Integration** | AI-02, AI-16, AI-18, AI-20 hepsi bu profili context'e alır |
| **Visibility** | Settings > "My Travel Profile" → görüntüle + manuel override |

**Maliyet:** Haftalık Haiku ~$0.01/user
**Effort:** Orta (4-5 gün)
**Impact:** 🔥🔥🔥 — Tüm diğer AI feature'ların kalitesini çarpan olarak artırır.

---

### AI-32: Place Memory Recall

**Kaynak:** v3 yeni

**Ne:** "İki yıl önce gittiğim o pizza yerini hatırlıyor musun?" gibi fuzzy memory search.

**Neden:**
- Kullanıcılar mekan adını hatırlamaz ama özelliği hatırlar.
- Semantic search with pgvector + AI interpretation.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Pipeline** | Query → embedding → pgvector similarity (kullanıcının mekanları) + AI re-rank |
| **Date parsing** | "iki yıl önce", "geçen bahar" → created_at/visited_at range |
| **UI** | AI-02 chat içinde ya da dedicated search modu |

**Maliyet:** Embedding + Haiku ~$0.001/sorgu
**Effort:** Orta (3-4 gün — pgvector altyapı gerekir)
**Impact:** 🔥🔥

---

### AI-33: Lifecycle Reminders ("Hâlâ ilgileniyor musun?")

**Kaynak:** v3 yeni

**Ne:** AI periyodik olarak eski "want_to_go" mekanları inceler ve kullanıcıya "Bu mekanı 2 yıl önce eklemiştin, hâlâ gitmek istiyor musun?" sorusu sorar.

**Neden:**
- "want_to_go" listesi zamanla kirlenir.
- Retention: kullanıcıyı tekrar engage eder.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Cron** | Aylık Supabase cron |
| **Criteria** | `visit_status = 'want_to_go' AND created_at < now() - interval '1 year'` |
| **Action** | In-app notification: "X yerini 2 yıl önce eklemiştin. Hâlâ gitmek ister misin? [Evet, hatırlat] [Arşivle] [Sil]" |
| **Batch** | 5 mekan / bildirim, sık bildirimlerden kaçın |

**Maliyet:** Zero (rule-based, LLM opsiyonel)
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥 — Retention detayı.

---

### AI-34: Year in Review (AI Narrative)

**Kaynak:** v3 yeni

**Ne:** Yıl sonunda Spotify Wrapped tarzı narrative özet: "2026'da 142 mekan keşfettin, 8 ülke gezdin, favori kategorin Cafe, Aralık'ta Istanbul'da en aktifsin."

**Content:**
- Sayılar (F-14 stats üzerine)
- AI narrative (persona + top moments)
- Görsel kartlar (kapak, kategori, harita heatmap)
- Paylaşılabilir (Instagram story formatı)

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | 31 Aralık + opt-in "Anytime" butonu |
| **Data** | Tüm yıl places + visited_at + trips + activity_log |
| **LLM** | Opus (uzun context, yaratıcı çıktı) |
| **Output** | Multi-card swipe UI (Instagram story style) |
| **Export** | PNG download per card + share link |

**Maliyet:** Opus ~$0.15-0.25/kullanıcı (yıl sonu one-shot)
**Effort:** Yüksek (6-8 gün — UI emeği yoğun)
**Impact:** 🔥🔥🔥 — Yıllık viral moment, basın değeri.

---

## Grup O — Productivity Automation

---

### AI-35: AI Search Suggestions

**Kaynak:** v3 yeni

**Ne:** Arama çubuğu boşken AI proaktif öneriler: "Geçen ay eklediğin mekanlar?", "Paris'teki favoriler?"

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | Search input focused, empty |
| **Suggestions** | Son aktivite + AI-31 profile + time context |
| **LLM** | Haiku (ucuz, hızlı) |
| **UI** | Search dropdown'da 3-5 chip |

**Maliyet:** Haiku ~$0.0003/suggestion set, aggresif cache
**Effort:** Düşük (1-2 gün)
**Impact:** 🔥

---

### AI-36: Smart Anomaly Detection

**Kaynak:** v3 yeni

**Ne:** DataForSEO refresh sırasında anomali tespiti: rating düşüşü, kapanış, yeni açılış. Kullanıcıyı bilgilendir.

**Örnek:**
```
"Dikkat: 'Kafe X' rating'i 4.6 → 3.2 düştü (son 30 günde).
Son yorumları kontrol etmek ister misin?"

"'Restoran Y' artık 'kalıcı kapandı' olarak işaretlenmiş.
Listelerinden kaldırmak ister misin?"
```

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Trigger** | DataForSEO enrichment sonrası |
| **Comparison** | Eski google_data vs yeni — rating delta, status change |
| **AI layer** | Önemli anomalileri filtreleyip user-facing bildirime dönüştür |
| **Notification** | In-app notification (F-17) |

**Maliyet:** Rule-based bedava, AI opsiyonel ~$0.001/delta
**Effort:** Düşük-Orta (2-3 gün)
**Impact:** 🔥🔥

---

### AI-37: Smart Notification Timing

**Kaynak:** v3 yeni (📎 F-17 push notification ile entegre)

**Ne:** Kullanıcının en engage olduğu saati öğrenip push notification'ları optimum saatte gönderir.

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Analiz** | activity_log üzerinden kullanıcı active hours pattern |
| **Model** | Simple heuristic (median active hour) — no LLM gerekmiyor |
| **Notification scheduling** | Cron deferrable until optimum time |

**Maliyet:** Zero
**Effort:** Orta (2-3 gün)
**Impact:** 🔥 — Küçük detay, büyük engagement farkı.

---

### AI-38: AI Tag Cleanup Wizard

**Kaynak:** v3 yeni

**Ne:** Settings > Tags altında "Cleanup with AI" butonu → AI similar tag'leri tespit eder, merge önerisi sunar ("beach" + "plaj" + "sahil" → birleştir?).

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Input** | Tüm user tags |
| **LLM** | Haiku (structured output) |
| **Output** | Merge groups: `[{primary: "beach", merge: ["plaj","sahil","seashore"]}, ...]` |
| **Review UI** | Tek tek onay/red + rename opsiyonu |
| **API** | `POST /api/tags/merge` |

**Maliyet:** Haiku ~$0.005/cleanup session
**Effort:** Düşük-Orta (2-3 gün)
**Impact:** 🔥🔥 — Tag hygiene için kritik.

---

# PART 3 — AI ALTYAPI STRATEJİSİ

## 3.1 SDK & Provider Seçimi

### Vercel AI SDK v6 — Neden?

- **Unified API:** Claude, OpenAI, Google, Ollama — tek interface
- **Streaming:** First-class support (`streamText`, `useChat`)
- **Structured output:** `generateObject` + Zod
- **Tool use:** Claude'un native fonksiyon çağırma desteği
- **Provider switching:** Environment variable ile Claude → GPT geçişi kolay
- **Observability:** Vercel AI Gateway ile token/cost tracking

### Paket Kurulumu

```bash
pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod
```

Mevcut `zod` zaten kurulu — package.json uyumlu.

### Claude Model Tercihleri

| Use case | Model | Reasoning |
|----------|-------|-----------|
| Günlük işlemler (filter parse, categorization, tag) | `claude-haiku-4.6` | Düşük maliyet, <1s latency |
| Chat, trip planning | `claude-sonnet-4.6` | Tool use, tercih edilen reasoning |
| Year in Review, Long narratives | `claude-opus-4.6` | Uzun context, yaratıcı çıktı |
| Vision (image analysis) | `claude-sonnet-4.6` | Built-in vision, güçlü |

### Opsiyonel: Vercel AI Gateway

Eğer observability + fallback istenirse:
```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { gateway } from '@ai-sdk/gateway';

const model = gateway('anthropic/claude-sonnet-4.6');
// Fallback'ler otomatik yönetilir
```

## 3.2 Cost Model & Rate Limits

### Projected Monthly Cost (100 active users)

| Feature | Usage/month | Cost |
|---------|-------------|------|
| AI-01 Filter parse | 3,000 req | $1.50 |
| AI-02 Chat | 1,500 turns | $22.50 (Sonnet) |
| AI-05 Categorization | 2,000 places | $2.00 |
| AI-06 Tag suggestions | 1,500 places | $1.50 |
| AI-10 Summaries | 500 places | $1.50 |
| AI-11 Note polish | 200 notes | $0.10 |
| AI-12 Sentiment | 300 places | $0.90 |
| AI-13 Translation | 500 reviews | $1.00 |
| AI-14 Share captions | 200 shares | $0.40 |
| AI-15 Trip story | 50 trips | $4.00 (Sonnet) |
| AI-16 Recommendations | 1,000 req | $5.00 |
| AI-17 Web discovery | 300 req | $15.00 |
| AI-18 Mood matcher | 500 req | $7.50 |
| AI-20 Trip planner | 100 plans | $10.00 |
| AI-21 Trip briefing | 200 brifings | $4.00 |
| AI-26 Vision | 300 images | $3.00 |
| AI-27 Photo-to-place | 100 images | $1.50 |
| AI-28 Voice notes | 200 notes | $2.00 |
| AI-29 Map screenshot | 50 screenshots | $1.00 |
| AI-30 Receipt OCR | 100 receipts | $1.50 |
| AI-31 Profile gen | 100 users | $1.00 |
| AI-34 Year in Review | (annual) | $15.00/yıl = $1.25/ay |
| **Embeddings (one-time setup per place)** | ~2,000 places | $0.05 |
| **TOPLAM aylık** | | **~$87** |

Yıllık cost per active user: **~$10.44/user/year**

### Rate Limiting Plan

| Tier | AI Quota | Price |
|------|----------|-------|
| **Free** | 30 AI operations/month | $0 |
| **Pro** | 1,000 AI ops + priority queue | $4.99/month |
| **BYOK Pro** | Unlimited (own API key) | $2.99/month |

### Rate limit enforcement

```typescript
// Upstash Ratelimit + Vercel Marketplace Redis
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, '30 d'),
});
```

## 3.3 DB Schema Değişiklikleri

### Yeni tablolar

```sql
-- AI api key (per-user BYOK)
ALTER TABLE profiles ADD COLUMN anthropic_api_key_enc text;
ALTER TABLE profiles ADD COLUMN openai_api_key_enc text; -- ASR/TTS için

-- Chat history
CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text,
  created_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES chat_sessions ON DELETE CASCADE NOT NULL,
  role text NOT NULL, -- 'user' | 'assistant' | 'tool'
  content jsonb NOT NULL, -- text + tool_calls + tool_results
  tokens_input integer,
  tokens_output integer,
  model text,
  created_at timestamptz DEFAULT now()
);

-- Long-term memory
CREATE TABLE chat_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  content text NOT NULL, -- "Kullanıcı vegan", "kısa yürüyüş sever"
  category text, -- 'preference' | 'dietary' | 'mobility'
  confidence float,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

-- Travel profile (AI-31)
CREATE TABLE user_travel_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  profile_json jsonb NOT NULL,
  version integer DEFAULT 1,
  generated_at timestamptz DEFAULT now()
);

-- AI generic cache
CREATE TABLE ai_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users,
  resource_type text NOT NULL, -- 'summary' | 'sentiment' | 'translation' | 'caption' | ...
  resource_id uuid,
  cache_key text NOT NULL,
  content jsonb NOT NULL,
  language text,
  model text,
  tokens_used integer,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX ON ai_cache (user_id, resource_type, cache_key);
CREATE INDEX ON ai_cache (expires_at) WHERE expires_at IS NOT NULL;

-- pgvector (AI-16, AI-32)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE place_embeddings (
  place_id uuid PRIMARY KEY REFERENCES places ON DELETE CASCADE,
  embedding vector(1024) NOT NULL,
  content_hash text NOT NULL, -- re-embed gerekiyor mu kontrolü
  model text NOT NULL,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX ON place_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- pg_trgm (AI-08)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON places USING gin (name gin_trgm_ops);
```

### Mevcut tablo değişiklikleri

```sql
-- Trip schema ek
ALTER TABLE trip_days ADD COLUMN routing_profile text DEFAULT 'walking';
ALTER TABLE trip_days ADD COLUMN theme text;
ALTER TABLE trip_days ADD COLUMN emoji text;
ALTER TABLE trip_day_places ADD COLUMN cost_estimate numeric;
ALTER TABLE trip_day_places ADD COLUMN currency text DEFAULT 'USD';
ALTER TABLE trips ADD COLUMN party_size integer DEFAULT 1;
ALTER TABLE trips ADD COLUMN parent_trip_id uuid REFERENCES trips(id);

-- Onboarding
ALTER TABLE profiles ADD COLUMN onboarding_completed boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN preferred_language text DEFAULT 'tr';
ALTER TABLE profiles ADD COLUMN ai_opt_in boolean DEFAULT true;

-- shared_links.resource_type artık 'place' de olabilir (app-level; DB string kalır)

-- Usage tracking için SKU tipleri (string, migration gerekmez)
-- Yeni SKU'lar: ai_haiku_input, ai_haiku_output, ai_sonnet_input, ai_sonnet_output,
-- ai_opus_input, ai_opus_output, ai_vision, ai_embedding, whisper_minutes, tts_chars
```

## 3.4 Caching Stratejisi

### Üç katmanlı cache

**1. google_data JSONB (per-place cache):**
- `ai_summary`, `ai_sentiment`, `ai_topics`
- Refresh ile birlikte invalidate

**2. ai_cache tablosu (generic cache):**
- Çok kısa ömürlü: filter parse (1 saat)
- Orta: translation (30 gün)
- Uzun: trip summary (90 gün)

**3. Runtime Cache (Vercel):**
- Vercel Runtime Cache API ile per-region key-value
- Popüler sorgular (AI-17 discover) için shared

### Invalidation Rules

| Event | Cache invalidated |
|-------|-------------------|
| Place refresh | ai_summary, ai_sentiment, ai_topics, place_embedding |
| Place delete | Tüm AI cache + embedding |
| User language change | Translation cache (sadece eski dil) |
| Trip edit | Trip-level AI cache |

## 3.5 pgvector & Embedding Infrastructure

### Embedding generation pipeline

```typescript
// src/lib/ai/embeddings.ts
import { embed } from 'ai';
import { voyage } from '@ai-sdk/voyage'; // veya openai embedding

export async function embedPlace(place: Place): Promise<number[]> {
  const content = [
    place.name,
    place.address,
    place.category?.name,
    place.tags?.map(t => t.name).join(' '),
    place.notes,
    place.google_data?.business_description,
    Object.keys(place.google_data?.place_topics ?? {}).slice(0, 5).join(' '),
  ].filter(Boolean).join(' | ');

  const { embedding } = await embed({
    model: voyage.embedding('voyage-3-large'),
    value: content,
  });

  return embedding;
}
```

### Trigger embedding

| Trigger | Action |
|---------|--------|
| Place create | Embed (async, background job) |
| Place update (name/notes/tags/category) | Re-embed |
| Place enrich (DataForSEO) | Re-embed |
| Place delete | CASCADE delete embedding |

### Similarity query

```sql
SELECT place_id, 1 - (embedding <=> $1::vector) AS similarity
FROM place_embeddings
WHERE place_id IN (SELECT id FROM places WHERE user_id = $2)
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

---

# PART 4 — PRIORITY MATRIX & SPRINT ROADMAP

## 4.1 Impact vs Effort Matrix (v3 Features)

```
                          IMPACT
               Low         Medium         High
         ┌──────────┬──────────────┬──────────────┐
  Low    │          │ NF-01        │ NF-03        │
  Effort │          │ NF-12        │ NF-20        │
         │          │ AI-05        │ AI-01 (v2)   │
         │          │ AI-11        │ AI-06        │
         │          │ AI-13        │ AI-24        │
         │          │ AI-23        │              │
         │          │ AI-33        │              │
         │          │ AI-35        │              │
         │          │ AI-37        │              │
         ├──────────┼──────────────┼──────────────┤
  Med    │ NF-11    │ NF-02        │ NF-04        │
  Effort │ AI-14    │ NF-05        │ NF-06        │
         │ AI-36    │ NF-07        │ NF-09        │
         │          │ NF-13        │ NF-16        │
         │          │ NF-15        │ NF-17        │
         │          │ NF-18        │ NF-19        │
         │          │ NF-21        │ NF-22        │
         │          │ AI-07        │ AI-17        │
         │          │ AI-08        │ AI-18        │
         │          │ AI-09        │ AI-31        │
         │          │ AI-10 (v2)   │ AI-21        │
         │          │ AI-12        │              │
         │          │ AI-15        │              │
         │          │ AI-19        │              │
         │          │ AI-22        │              │
         │          │ AI-26 (v2)   │              │
         │          │ AI-27        │              │
         │          │ AI-29        │              │
         │          │ AI-30        │              │
         │          │ AI-32        │              │
         │          │ AI-38        │              │
         ├──────────┼──────────────┼──────────────┤
  High   │          │ NF-10        │ NF-23        │
  Effort │          │ NF-14        │ AI-02 (v2)   │
         │          │ NF-24        │ AI-04        │
         │          │ AI-03        │ AI-16        │
         │          │ AI-25        │ AI-20 (v2)   │
         │          │ AI-28        │ AI-34        │
         └──────────┴──────────────┴──────────────┘
```

## 4.2 Önerilen Sprint Planı

### Sprint A — Quick Wins (1-2 hafta)

**Hedef:** DataForSEO verisini UI'ya aç + ilk AI quick win'ler

| ID | Feature | Effort |
|----|---------|--------|
| NF-01 | Rating Distribution | 1g |
| NF-02 | Popular Times Widget | 2g |
| NF-03 | Place Topics Tag Cloud | 1g |
| NF-04 | Attributes & Status Badges | 3g |
| NF-05 | Similar Places | 3g |
| NF-06 | Action Buttons + Owner Answer | 3g |
| **Sprint A Total** | | **~13 gün** |

**DataForSEO verisinin tamamı UI'da görünür. Kullanıcı deneyimi dramatik artar, yeni AI maliyeti yok.**

### Sprint B — AI Foundation (2-3 hafta)

**Hedef:** AI infrastructure + düşük risk, yüksek değer AI feature'lar

| ID | Feature | Effort |
|----|---------|--------|
| — | AI SDK v6 + Anthropic setup | 1g |
| — | ai_cache tablosu + encryption key | 0.5g |
| — | Rate limiting (Upstash) | 0.5g |
| AI-01 | NL Filter | 3g |
| AI-05 | Kategorizasyon | 2g |
| AI-06 | Tag suggestions (hybrid) | 2g |
| AI-10 | Review özeti | 3g |
| AI-11 | Note polish | 1g |
| AI-13 | Review translation | 2g |
| AI-14 | Share captions | 1g |
| **Sprint B Total** | | **~16 gün** |

### Sprint C — Conversational Core (3-4 hafta)

**Hedef:** Chat + discovery core

| ID | Feature | Effort |
|----|---------|--------|
| AI-02 | Conversational Chatbot | 10g |
| AI-17 | AI Discovery (web search) | 4g |
| AI-18 | Mood Matcher | 4g |
| AI-31 | Travel Profile | 5g |
| NF-16 | Onboarding Wizard | 5g |
| **Sprint C Total** | | **~28 gün** |

### Sprint D — Trip Intelligence (3-4 hafta)

**Hedef:** AI trip planning ekosistemi

| ID | Feature | Effort |
|----|---------|--------|
| AI-20 | AI Trip Planner | 10g |
| AI-21 | Trip Briefing | 5g |
| AI-22 | Itinerary Critique | 4g |
| AI-04 | Conversational Trip Editor | 7g |
| NF-07 | Multi-modal Routing | 2g |
| NF-08 | Trip Budget | 4g |
| NF-09 | Trip Templates | 6g |
| **Sprint D Total** | | **~38 gün** |

### Sprint E — Visual & Voice (2-3 hafta)

| ID | Feature | Effort |
|----|---------|--------|
| AI-26 | Vision (v2) | 4g |
| AI-27 | Photo-to-place | 3g |
| AI-28 | Voice notes | 6g |
| AI-29 | Map screenshot | 3g |
| AI-30 | Receipt OCR | 4g |
| AI-03 | Voice Conversation | 7g |
| **Sprint E Total** | | **~27 gün** |

### Sprint F — Recommendations & Memory (3-4 hafta)

| ID | Feature | Effort |
|----|---------|--------|
| — | pgvector setup + embedding pipeline | 2g |
| AI-16 | Personalized Recommendations | 10g |
| AI-32 | Memory Recall | 4g |
| AI-19 | AI Comparison | 4g |
| AI-08 | AI Duplicate Detection | 5g |
| AI-09 | Bulk Re-categorization | 4g |
| AI-38 | Tag Cleanup | 3g |
| **Sprint F Total** | | **~32 gün** |

### Sprint G — Content & Polish (2-3 hafta)

| ID | Feature | Effort |
|----|---------|--------|
| AI-12 | Sentiment | 4g |
| AI-15 | Trip Story | 4g |
| AI-23 | Day Themes | 1g |
| AI-24 | Best Time to Visit | 2g |
| AI-33 | Lifecycle Reminders | 2g |
| AI-35 | Search Suggestions | 2g |
| AI-36 | Anomaly Detection | 3g |
| AI-37 | Notification Timing | 3g |
| NF-10 | Trip Journal | 7g |
| NF-22 | Export (F-12) | 3g |
| **Sprint G Total** | | **~31 gün** |

### Backlog (Sprint H+)

- AI-25 Multi-City Trip Optimizer
- AI-34 Year in Review (yıl sonu pre-sprint)
- NF-11 Calendar
- NF-12 Heatmap
- NF-13 Category Layer Toggle
- NF-14 Drawing Tools
- NF-15 Cluster Improvements
- NF-17 Nearby Filter (F-08 impl)
- NF-18 Single Place Sharing
- NF-19 Bulk Edit
- NF-20 Quick Filter Chips
- NF-21 Saved Filters (F-03 impl)
- NF-23 PWA Enhanced
- NF-24 Browser Extension
- v2 backlog: F-13, F-15, F-16, F-18

---

# PART 5 — v2 OVERLAP & CROSS-CUTTING CONCERNS

## 5.1 v2 ↔ v3 Eşleştirme Tablosu

v3'teki her öneri için v2'deki ilgili madde (varsa):

| v3 ID | v3 Başlık | v2 Karşılığı | Durum |
|-------|-----------|--------------|-------|
| NF-01 | Rating Distribution | — | Yeni v3 |
| NF-02 | Popular Times | — | Yeni v3 |
| NF-03 | Place Topics Tag Cloud | — | Yeni v3 |
| NF-04 | Attributes & Status | — | Yeni v3 (kısmen AI-06 kapsıyordu) |
| NF-05 | Similar Places | — | Yeni v3 (AI-07'ye temel) |
| NF-06 | Action Buttons + Owner | — | Yeni v3 |
| NF-07 | Multi-Modal Routing | v2 known limitation | 📎 v2 referansı |
| NF-08 | Trip Budget | — | Yeni v3 |
| NF-09 | Trip Templates | — | Yeni v3 |
| NF-10 | Trip Journal | F-15 kısmen | 📎 F-15 extend |
| NF-11 | Calendar View | — | Yeni v3 |
| NF-12 | Heatmap | — | Yeni v3 |
| NF-13 | Category Layer | — | Yeni v3 |
| NF-14 | Drawing Tools | — | Yeni v3 |
| NF-15 | Cluster Improvements | — | Yeni v3 |
| NF-16 | Onboarding Wizard | F-01 ile ilişkili | 📎 F-01 ile birleştir |
| NF-17 | Nearby Filter | F-08a | 📎 v2 impl |
| NF-18 | Single Place Sharing | F-11a extension | 📎 F-11a extend |
| NF-19 | Bulk Edit | — | Yeni v3 |
| NF-20 | Quick Filter Chips | — | Yeni v3 |
| NF-21 | Saved Filters | F-03 | 📎 v2 impl |
| NF-22 | Export | F-12 | 📎 v2 impl |
| NF-23 | Enhanced PWA | F-17 | 📎 F-17 extend |
| NF-24 | Browser Extension | — | Yeni v3 |
| AI-01 | NL Filter | AI-01 | 📎 v2 devamı |
| AI-02 | Chatbot | AI-02 | 📎 v2 devamı + tool use genişleme |
| AI-03 | Voice Conversation | F-05 voice extend | 📎 yeni |
| AI-04 | Conversational Trip Editor | — | Yeni v3 |
| AI-05 | Akıllı Kategorizasyon | AI-03 | 📎 v2 devamı |
| AI-06 | Tag Suggestion | AI-04 | 📎 v2 devamı + DataForSEO hybrid |
| AI-07 | Import Enrichment | AI-08 | 📎 v2 devamı |
| AI-08 | Duplicate Detection | F-13 AI layer | 📎 F-13 AI versiyonu |
| AI-09 | Bulk Recategorization | — | Yeni v3 |
| AI-10 | Review Summary | AI-05 | 📎 v2 devamı + 50 review |
| AI-11 | Note Polishing | — | Yeni v3 |
| AI-12 | Sentiment | AI-06 | 📎 v2 devamı |
| AI-13 | Translation | — | Yeni v3 |
| AI-14 | Share Caption | — | Yeni v3 |
| AI-15 | Trip Story | — | Yeni v3 |
| AI-16 | Recommendations | AI-07 | 📎 v2 devamı (full impl) |
| AI-17 | Web Discovery | — | Yeni v3 |
| AI-18 | Mood Matcher | — | Yeni v3 |
| AI-19 | AI Comparison | F-04 + AI | 📎 F-04 AI extension |
| AI-20 | Trip Planner | AI-09 | 📎 v2 devamı + DataForSEO |
| AI-21 | Trip Briefing | — | Yeni v3 |
| AI-22 | Itinerary Critique | — | Yeni v3 |
| AI-23 | Day Themes | — | Yeni v3 |
| AI-24 | Best Time | — | Yeni v3 |
| AI-25 | Multi-City | — | Yeni v3 |
| AI-26 | Vision | AI-10 | 📎 v2 devamı |
| AI-27 | Photo-to-Place | — | Yeni v3 |
| AI-28 | Voice Notes | F-05 voice | 📎 F-05 extend |
| AI-29 | Map Screenshot | — | Yeni v3 |
| AI-30 | Receipt OCR | — | Yeni v3 |
| AI-31 | Travel Profile | — | Yeni v3 |
| AI-32 | Memory Recall | — | Yeni v3 |
| AI-33 | Lifecycle Reminders | — | Yeni v3 |
| AI-34 | Year in Review | — | Yeni v3 |
| AI-35 | Search Suggestions | — | Yeni v3 |
| AI-36 | Anomaly Detection | — | Yeni v3 |
| AI-37 | Notification Timing | F-17 extension | 📎 F-17 ile entegre |
| AI-38 | Tag Cleanup | — | Yeni v3 |

**Özet:**
- **Toplam v3 önerisi:** 24 Non-AI (NF-01..24) + 38 AI (AI-01..38) = **62 madde**
- **v2'den devam eden:** 21 madde (📎 işaretli)
- **v3'e özgü yeni:** 41 madde

## 5.2 Yeni API Endpoints Özeti (v3)

```
/api/ai/parse-query          POST      AI-01
/api/ai/chat                 POST(S)   AI-02
/api/ai/chat-sessions        GET/POST  AI-02
/api/ai/chat-sessions/[id]   GET/DELETE AI-02
/api/ai/voice/transcribe     POST      AI-03, AI-28
/api/ai/voice/tts            POST      AI-03
/api/ai/trip-edit            POST      AI-04
/api/ai/categorize           POST      AI-05
/api/ai/suggest-tags         POST      AI-06
/api/ai/enrich-import        POST      AI-07
/api/ai/detect-duplicates    GET       AI-08
/api/ai/bulk-recategorize    POST      AI-09
/api/ai/summarize-place      POST      AI-10
/api/ai/polish-note          POST      AI-11
/api/ai/sentiment            POST      AI-12
/api/ai/translate            POST      AI-13
/api/ai/share-caption        POST      AI-14
/api/ai/trip-story           POST      AI-15
/api/ai/recommend            GET       AI-16
/api/ai/discover             POST      AI-17
/api/ai/mood-match           POST      AI-18
/api/ai/compare              POST      AI-19
/api/ai/plan-trip            POST(S)   AI-20
/api/ai/trip-briefing        POST      AI-21
/api/ai/critique-trip        POST      AI-22
/api/ai/day-themes           POST      AI-23
/api/ai/best-time            POST      AI-24
/api/ai/multi-city           POST      AI-25
/api/ai/vision/recognize     POST      AI-26, AI-27
/api/ai/vision/map-screenshot POST     AI-29
/api/ai/vision/receipt       POST      AI-30
/api/ai/profile              GET/POST  AI-31
/api/ai/memory-search        POST      AI-32
/api/ai/year-in-review       POST      AI-34
/api/ai/search-suggestions   GET       AI-35
/api/ai/tag-cleanup          POST      AI-38

/api/ai/usage                GET       quota check
/api/ai/memories             GET/POST/DELETE  AI-02 long-term

/api/places/duplicates       GET       F-13 rule-based (v2)
/api/places/merge            POST      F-13 (v2)
/api/places/export           GET       F-12 (v2)
/api/places/nearby           GET       F-08a (v2)
/api/places/bulk             PATCH     NF-19
/api/places/embeddings       POST      AI-16 background
/api/lists/[id]/reorder-trip PATCH     Trip reorder (var)
/api/trips/[id]/budget       GET       NF-08
/api/trip-templates          GET/POST  NF-09
/api/trip-photos             POST/DELETE NF-10
/api/calendar                GET       NF-11
/api/shared/[slug]           var       NF-18 için resource_type='place'
/api/saved-filters           GET/POST/DELETE  F-03 / NF-21
/api/notifications           GET       F-17 / NF-23
/api/push/subscribe          POST      NF-23
/api/tags/merge              POST      AI-38
```

## 5.3 Yeni DB Tablo/Kolon Özeti

**Yeni tablolar (13):**
- `chat_sessions`, `chat_messages`, `chat_memories` (AI-02)
- `user_travel_profiles` (AI-31)
- `ai_cache` (cross-cutting)
- `place_embeddings` (AI-16, AI-32)
- `saved_filters` (F-03 / NF-21) — v2'den
- `trip_templates` (NF-09)
- `trip_photos` (NF-10)
- `notifications` (F-17 / NF-23)
- `activity_log` (F-16) — v2'den
- `push_subscriptions` (NF-23)

**Mevcut tablo değişiklikleri:**

| Tablo | Kolon | Feature |
|-------|-------|---------|
| profiles | anthropic_api_key_enc, openai_api_key_enc | AI altyapı |
| profiles | onboarding_completed, preferred_language, ai_opt_in | NF-16, i18n |
| places | reservation_date | F-17 |
| places | source: 'manual_pin', 'quick_save' | F-01, F-05 |
| trip_days | routing_profile, theme, emoji | NF-07, AI-23 |
| trip_day_places | cost_estimate, currency | NF-08 |
| trips | party_size, parent_trip_id | NF-08, AI-25 |
| shared_links | resource_type: 'place' | NF-18 |

**Extension'lar:**
- `vector` (pgvector) — AI-16, AI-32
- `pg_trgm` — AI-08, F-13

## 5.4 Yeni Dependencies

```json
{
  "dependencies": {
    // AI
    "ai": "^6.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/react": "^2.0.0",

    // Rate limiting
    "@upstash/ratelimit": "^2.0.0",
    "@upstash/redis": "^2.0.0",

    // Rich text (F-15 / AI-11)
    "@tiptap/react": "^2.0.0",
    "@tiptap/starter-kit": "^2.0.0",

    // Map drawing (NF-14)
    "@mapbox/mapbox-gl-draw": "^1.4.0",
    "@turf/boolean-point-in-polygon": "^7.0.0",

    // Calendar (NF-11)
    "react-day-picker": "^9.0.0",

    // ASR/TTS (AI-28) — alternative: use SDK directly
    "openai": "^5.0.0", // for Whisper + TTS

    // EXIF parsing (NF-10)
    "exifreader": "^4.0.0",

    // ICS export (NF-11)
    "ics": "^3.0.0"
  }
}
```

**Bundle size impact:**
- AI SDK: ~30KB gzipped (server-side çoğunluk)
- Tiptap: ~80KB (lazy-load öneri)
- Mapbox-gl-draw: ~50KB (map page only)
- Toplam ek: ~200KB (route-based code split ile yönetilebilir)

---

# SONUÇ

Bu v3 dökümanı, v2'den bu yana implement edilen **10 feature**'ı dikkate alarak, **41 tamamen yeni + 21 v2 devamı = 62 öneri** sunar.

**Üç stratejik tema:**

1. **DataForSEO verisinin tam sömürüsü** (NF-01..06): Hiç AI maliyeti olmadan UI'ı dramatik zenginleştirir.

2. **AI-first dönüşüm** (AI-01..38): Uygulamayı "organizasyon aracı"ndan "intelligent travel companion"a taşır. 38 öneri 8 grup altında; her biri somut prompt, cost, effort ve impact değerlendirmesiyle.

3. **Post-v2 olgunluk** (NF-07..24): Trip Planner, Sharing, Stats gibi yeni üstyapılar üzerinde retention + onboarding + power-user özellikleri.

**Önerilen başlangıç:** Sprint A + Sprint B (ilk 4 hafta) → DataForSEO görselleştirme + AI foundation. Bu iki sprint ile uygulama AI-capable bir ürüne dönüşür ve sonraki sprint'ler bu üstyapı üzerine inşa edilir.

**Projected cost:** 100 aktif kullanıcı için ~$87/ay AI operasyonu, ~$10/user/yıl — tier modeli ile sürdürülebilir.

---

> **Belge sonu.** Sorular/yorumlar için `feat/ai-features` branch'inde tartışma açılabilir.
