# DataForSEO Business Data API vs Google Places API (New)
# Map Organiser Entegrasyon Analizi

> **Tarih:** 2026-04-14
> **Amaç:** DataForSEO'nun Google Business Data API'sini mevcut Google Places API (New) entegrasyonumuza
> alternatif veya tamamlayıcı olarak değerlendirmek.

---

## 1. Mevcut Durumunuz (Google Places API)

### Kullanılan Endpoint'ler

| Fonksiyon | Google Endpoint | Tier | Maliyet |
|-----------|----------------|------|---------|
| `getPlaceDetails(placeId)` | GET `/v1/places/{id}` | Pro | **$17/1K** |
| `searchPlace(query)` | POST `/v1/places:searchText` | Pro | **$17/1K** |
| `getPlaceReviews(placeId)` | GET `/v1/places/{id}` (reviews mask) | Enterprise | **$20/1K** |
| `downloadAndStorePhoto(ref)` | GET `/v1/{photoName}/media` | Photos | **$7/1K** |

### Dönen Veri Alanları (Pro Tier)
```
id, displayName, formattedAddress, addressComponents, location, types,
rating, userRatingCount, currentOpeningHours, regularOpeningHours,
websiteUri, nationalPhoneNumber, photos (refs), priceLevel, googleMapsUri
```

### Mevcut Maliyet Profili

| İşlem | Çağrılar | Maliyet |
|-------|----------|---------|
| 1 mekan ekleme (link) | 1 Search/Detail + 1 Photo | ~$0.024 |
| 1 mekan refresh (reviews) | 1 Detail + 1 Reviews + 1 Photo | ~$0.044 |
| 100 mekan CSV import | 100 Search + 100 Photo | ~$2.40 |
| Free tier | Her SKU için aylık ilk 1K-5K | $0 |

### Google'ın Avantajları (mevcut)
- Senkron API (anında yanıt)
- Place ID ile direkt erişim (ChIJ format)
- Field mask ile maliyet kontrolü (istediğin alanları seç)
- Ayda 5K'ya kadar ücretsiz (Pro tier)
- Photos API ile yüksek kalite görsel

---

## 2. DataForSEO Business Data API — Detaylı İnceleme

### 2.1 Genel Mimari

DataForSEO bir **SERP scraping** servisidir. Google'ın resmi API'sini kullanmaz — bunun yerine Google arama sonuçlarını ve Google Maps sayfalarını programatik olarak parse eder.

**Çalışma modeli:**
```
Sizin istek → DataForSEO sunucuları → Google SERP/Maps scrape → Parse → Size JSON yanıt
```

**İki erişim yöntemi:**

| Yöntem | Akış | Süre | Kullanım |
|--------|------|------|----------|
| **Async (Task POST + GET)** | POST → bekle → GET | 1-45 dk | Batch işlemler |
| **Live** | POST → anında yanıt | ~6-10 sn | Tek mekan sorgusu |

### 2.2 Kullanılabilir Endpoint'ler

| Endpoint | Açıklama | Google Karşılığı |
|----------|----------|------------------|
| **My Business Info** | İşletme profil detayları | Place Details (Pro) |
| **My Business Updates** | İşletme postları, güncellemeler | ❌ Yok |
| **Google Reviews** | Kullanıcı yorumları (max 4490) | Place Details (Enterprise) — ama max 5 review |
| **Questions & Answers** | Google Maps S&C | ❌ Yok |
| **Google Hotels** | Otel arama + detay + fiyat | ❌ Yok |

### 2.3 Fiyatlandırma Karşılaştırması

#### Business Info (Mekan Detayı)

| Provider | Yöntem | Maliyet/İstek | Maliyet/1K |
|----------|--------|---------------|------------|
| **Google Places API** | Senkron (anında) | $0.017 | **$17.00** |
| **DataForSEO Standard** | Async (1-45 dk) | $0.0015 | **$1.50** |
| **DataForSEO Priority** | Async (<1 dk) | $0.003 | **$3.00** |
| **DataForSEO Live** | Senkron (~6-10 sn) | $0.0054 | **$5.40** |

**→ DataForSEO Live: Google'dan ~3.1x ucuz**
**→ DataForSEO Standard: Google'dan ~11.3x ucuz**

#### Reviews (Yorumlar)

| Provider | Yöntem | Maliyet | Not |
|----------|--------|---------|-----|
| **Google Places API** | Enterprise tier | **$20/1K istek** (max 5 review/istek) | Yani 5K review = $20 |
| **DataForSEO Standard** | Async | **$0.075/1K review** | 10 review başına $0.00075 |
| **DataForSEO Priority** | Async (<1 dk) | **$0.15/1K review** | 10 review başına $0.0015 |

**Bu karşılaştırma dramatik:**
- Google: 1K istek = $20, her istekte max 5 review = **toplam 5K review → $20**
- DataForSEO: 5K review → yaklaşık **$0.375**
- **→ DataForSEO reviews'de ~53x ucuz**
- **→ Ve tek istekte 4490'a kadar review çekebilirsiniz (Google'da max 5)**

#### Fotoğraflar

| Provider | Maliyet | Not |
|----------|---------|-----|
| **Google Places API** | $7/1K photo media fetch | Yüksek kalite, direkt URL |
| **DataForSEO** | Business Info içinde dahil (ek maliyet yok) | `main_image` + `logo` URL döner, `total_photos` sayısı |

**Not:** DataForSEO fotoğraf URL'si döner ama bunlar Google CDN URL'leri — zaman sınırlı olabilir. Google Places API ise kalıcı `photoRef` verir.

### 2.4 Dönen Veri Karşılaştırması (My Business Info vs Place Details)

#### DataForSEO'nun Döndüğü AMA Google Places API'de OLMAYAN Alanlar

| Alan | Açıklama | Map Organiser İçin Değeri |
|------|----------|---------------------------|
| **`rating_distribution`** | 1-5 yıldız dağılımı (her yıldız kaç oy) | 🔥🔥🔥 Sentiment analizi, bar chart UI |
| **`popular_times`** | Gün ve saat bazlı yoğunluk (0-100 index) | 🔥🔥🔥 "Ne zaman gitmeliyim?" özelliği |
| **`place_topics`** | Review'lardan çıkarılan anahtar kelimeler + mention sayısı | 🔥🔥🔥 Otomatik tag önerisi, arama |
| **`people_also_search`** | İlişkili mekan önerileri | 🔥🔥 Recommendation engine için |
| **`is_claimed`** | İşletme sahibi doğrulaması | 🔥 Güvenilirlik göstergesi |
| **`current_status`** | opened/closed/temporarily_closed/closed_forever | 🔥🔥 Gerçek zamanlı durum |
| **`book_online_url`** | Online rezervasyon linki | 🔥🔥 Direkt aksiyon butonu |
| **`local_business_links`** | Rezervasyon, sipariş, menü linkleri | 🔥🔥🔥 Aksiyon butonları |
| **`additional_categories`** | Alt kategori dizisi | 🔥 Daha granüler kategorilendirme |
| **`category_ids`** | Evrensel kategori ID'leri | 🔥 Standardize kategorilendirme |
| **`original_title`** | Çevrilmemiş orijinal isim | 🔥 i18n desteği |
| **`snippet`** | Ek işletme bilgisi | 🔥 Açıklama alanı |
| **`description`** | İşletme açıklaması | 🔥🔥 editorialSummary alternatifi! |
| **`logo`** | Logo URL | 🔥 UI zenginleştirme |
| **`attributes`** | Hizmet özellikleri (wheelchair, wifi, vb.) | 🔥🔥🔥 Etiket otomasyonu |
| **`available_attributes`** | Sunulan hizmetler listesi | 🔥🔥 Filtre ve etiket verisi |
| **`unavailable_attributes`** | Sunulmayan hizmetler | 🔥 Negatif bilgi |
| **`directory`** | AVM/merkez içindeki alt işletmeler | 🔥 Bağlam bilgisi |
| **`contributor_url`** | Local Guide profili | 🔥 Kaynak güvenilirliği |

#### Google Places API'de OLAN ama DataForSEO'da OLMAYAN veya FARKLI Olan Alanlar

| Alan | Google | DataForSEO | Fark |
|------|--------|------------|------|
| **`addressComponents`** | Yapılandırılmış (types ile) | `address_info` (borough, city, zip, region, country_code) | Google daha granüler ama DataForSEO de yeterli |
| **`types[]`** | 200+ standart Google type | `category` + `category_ids` + `additional_categories` | Farklı format, eşleme gerekir |
| **`photos` (referans)** | `photoRef` → Media API ile indirme | `main_image` URL (tek foto) + `total_photos` sayısı | Google daha fazla foto erişimi, DataForSEO tek ana foto |
| **`priceLevel`** | Enum (0-4) | String ("inexpensive", "moderate", "expensive", "very_expensive") | Mapping gerekir |
| **`googleMapsUri`** | Direkt link | `check_url` (arama sonucu URL'si) | Farklı URL formatı |
| **Place ID** | Doğrudan kullanılır | `place_id` + `cid` + `feature_id` döner | DataForSEO da döndürüyor ✅ |
| **`editorialSummary`** | Kaldırıldı ($25/1K yüzünden) | `description` alanı (varsa) | DataForSEO'da ücretsiz! |

### 2.5 Reviews Karşılaştırması (Detaylı)

| Özellik | Google Places API | DataForSEO Reviews |
|---------|-------------------|--------------------|
| **Max review/istek** | 5 | **4,490** |
| **Maliyet/review** | ~$0.004 (5 review = $0.02) | **~$0.000075** |
| **Sıralama** | Yok (Google seçer) | `newest`, `highest_rating`, `lowest_rating`, `relevant` |
| **Review ID** | Yok | ✅ Benzersiz `review_id` |
| **Yazar profili** | İsim + fotoğraf | İsim + fotoğraf + profil URL + toplam review sayısı + toplam fotoğraf + **Local Guide durumu** |
| **Orijinal dil** | `originalText` alanı | `original_review_text` + `original_language` kodu |
| **Zaman bilgisi** | `relativePublishTimeDescription` + `publishTime` | `time_ago` + `timestamp` (UTC) |
| **Fotoğraflar** | Yok (review fotoğrafları yok) | **✅ Review fotoğrafları** (images array) |
| **İşletme yanıtı** | Yok | **✅ `owner_answer`** + `owner_timestamp` |
| **Helpful votes** | Yok | **✅ `votes_count`** (kaç kişi faydalı buldu) |
| **Review highlights** | Yok | **✅ `review_highlights`** (öne çıkan kriterler) |

**Bu tablo çok net gösteriyor: DataForSEO review verisi Google Places API'den kategorik olarak üstün.**

---

## 3. Avantajlar — DataForSEO Kullanmanın

### 3.1 Dramatik Maliyet Düşüşü

**Senaryo: 100 mekan import**

| İşlem | Google Places API | DataForSEO Live | Tasarruf |
|-------|-------------------|-----------------|----------|
| 100 mekan detayı | $1.70 | $0.54 | **%68** |
| 100 fotoğraf | $0.70 | $0 (dahil) | **%100** |
| **Toplam** | **$2.40** | **$0.54** | **%77.5** |

**Senaryo: 100 mekan + reviews (50 review/mekan)**

| İşlem | Google Places API | DataForSEO | Tasarruf |
|-------|-------------------|------------|----------|
| 100 mekan detayı | $1.70 | $0.54 (Live) | %68 |
| 100 × 50 reviews | 100 × $0.02 = $2.00 (ama max 5 review!) | 100 × $0.00375 = $0.375 (50 review!) | **%81** + **10x daha fazla review** |
| **Toplam** | **$3.70** (sadece 500 review) | **$0.915** (5000 review) | **%75 maliyet, 10x veri** |

### 3.2 Çok Daha Zengin Veri

DataForSEO'nun sağladığı ek veri, feature-suggestions_v2.md'deki birçok feature'ı doğrudan destekler:

| Ek Veri | Desteklediği Feature |
|---------|---------------------|
| `rating_distribution` (1-5 yıldız dağılımı) | AI-06: Sentiment Analizi — hazır veri, LLM gerektirmez |
| `popular_times` (yoğunluk saatleri) | Yeni feature: "En iyi zaman" önerisi |
| `place_topics` (anahtar kelimeler) | AI-04: Otomatik Etiket Önerisi — LLM'siz bile yapılabilir |
| `people_also_search` | AI-07: Recommendation Engine — hazır benzer mekan listesi |
| `attributes` (wifi, wheelchair, vb.) | Filtreleme: "wheelchair accessible", "wifi var" filtreleri |
| `owner_answer` (reviews'da) | UI zenginleştirme: işletme yanıtını göster |
| Review fotoğrafları | F-15: Zengin Medya — kullanıcı gönderimli fotoğraflar |
| `book_online_url` | CTA butonları: "Rezervasyon yap" direkt link |
| `local_business_links` | CTA butonları: sipariş, menü, rezervasyon |
| `description` | editorialSummary yerine — AI-05'e bile gerek kalmayabilir! |
| `is_claimed` | Güvenilirlik badge'i |
| 4490'a kadar review | AI-05, AI-06: Çok daha zengin sentiment + özet analizi |

### 3.3 Google API Key Bağımlılığının Azalması

- Mevcut sistemde her kullanıcı kendi Google API key'ini girmeli (veya admin fallback)
- DataForSEO ile tek bir API key (server-side) tüm kullanıcılara hizmet verir
- Kullanıcıdan Google API key isteme friction'ı ortadan kalkar

### 3.4 Reviews'de Devrim

- Google Places API: max 5 review, $20/1K istek, sıralama yok
- DataForSEO: **4490 review**, ~$0.075/1K review, sıralama seçenekleri
- Bu fark, AI feature'lar için temel oluşturur:
  - 50-100 review ile sentiment analizi çok daha doğru
  - Review fotoğrafları mekan detayını zenginleştirir
  - İşletme yanıtları güvenilirlik göstergesi
  - Local Guide durumu kaynak kalitesi filtresi

---

## 4. Dezavantajlar — DataForSEO'nun Riskleri

### 4.1 ⚠️ Yasal / ToS Riski (EN KRİTİK)

**DataForSEO bir SERP scraping servisidir.** Google'ın resmi API'si değildir.

- Google'ın Terms of Service'ı scraping'i yasaklar
- DataForSEO bu riski kendi üstlenir (onların sunucuları scrape yapar)
- **Sizin sorumluluğunuz:** DataForSEO API'sini kullanmanız doğrudan bir ToS ihlali değildir — ama Google bu servisleri engellemeye çalışabilir
- **Risk seviyesi:** Orta. DataForSEO 2014'ten beri çalışıyor ve büyük müşteri portföyü var
- **Azaltma:** DataForSEO kesintiye uğrasa bile Google Places API'ye fallback sistemi kurulabilir

### 4.2 ⚠️ Yanıt Süresi

| Yöntem | Süre | Kullanılabilirlik |
|--------|------|-------------------|
| Google Places API | **100-300ms** | Real-time UX ✅ |
| DataForSEO Live | **6-10 saniye** | Kabul edilebilir (loading spinner ile) ⚠️ |
| DataForSEO Standard | **1-45 dakika** | Sadece batch/import ✅ |
| DataForSEO Priority | **<1 dakika** | Batch'te iyi, real-time'da kötü ❌ |

**Etki:**
- **Mekan ekleme (link parse):** Kullanıcı link yapıştırıyor → şu an ~1-2sn Google yanıt → DataForSEO Live ile 6-10sn. Kullanıcı deneyiminde belirgin yavaşlama.
- **Import:** Async Standard ile sorun yok — zaten 200ms rate limit var, 45dk'ya kadar bekleme kabul edilebilir.
- **Google data refresh:** Live ile kabul edilebilir (kullanıcı zaten "yenile" butonuna bastı, beklemeye hazır).

### 4.3 ⚠️ Veri Güncelliği

- Google Places API: **gerçek zamanlı** Google veritabanı
- DataForSEO: Scrape **anında** yapılıyor (task oluşturulduğunda) — yani veri güncel
- **Ama:** Google SERP formatı değişirse DataForSEO parser'ı kırılabilir → geçici veri kesintisi

### 4.4 ⚠️ Fotoğraf Kalitesi ve Erişimi

- Google Places API: `photoRef` → media endpoint ile istediğin boyutta, kalıcı erişim
- DataForSEO: `main_image` URL (Google CDN) — tek fotoğraf, boyut kontrolü yok, URL geçici olabilir
- **Çözüm:** DataForSEO'dan gelen URL'yi hemen indirip Supabase Storage'a kaydet (mevcut pipeline ile aynı)
- **Kısıt:** Google'da 10+ fotoğraf olan mekandan sadece 1 fotoğraf gelir (`main_image`)

### 4.5 ⚠️ Text Search Yokluğu

**Bu en önemli teknik kısıt:**

- Google Places API: `places:searchText` → mekan adı ile arama → en yakın eşleşme
- DataForSEO My Business Info: `keyword` parametresi ile isim araması → ama bu bir SERP araması, Place ID ile doğrudan erişim değil
- **Sonuç:** Import sırasında "Los Compadres restaurant Berlin" araması DataForSEO'da daha az güvenilir olabilir
- **Çözüm:** `cid` veya `place_id` ile sorgulama (eğer Google URL'den çıkarabiliyorsak — ki mevcut parser çıkarıyor!)

### 4.6 ⚠️ Google Maps URL/Place ID Entegrasyonu

Mevcut akışımız:
```
Google Maps URL → parseMapsUrl() → ChIJ PlaceID / FTid / CID → getPlaceDetails(placeId)
```

DataForSEO ile:
```
Google Maps URL → parseMapsUrl() → CID veya PlaceID → DataForSEO(cid: "xxx" veya place_id: "xxx")
```

**Uyumluluk:** DataForSEO `cid` ve `place_id` parametrelerini kabul ediyor ✅ — mevcut URL parser pipeline'ı korunabilir.

### 4.7 ⚠️ Minimum Ödeme: $50

- DataForSEO minimum depozit $50
- Pay-as-you-go model (kredi bazlı)
- Küçük kullanımda bile $50 başlangıç gerekir

---

## 5. Hibrit Strateji Önerisi

**Sonuç olarak saf DataForSEO veya saf Google kullanmak yerine hibrit bir yaklaşım en mantıklı:**

### Katman 1 — Google Places API (Mevcut, Real-Time İşlemler)

| İşlem | Neden Google? |
|-------|---------------|
| **Link ile mekan ekleme** (parse-link) | Hız kritik (100-300ms), PlaceID ile doğrudan erişim, kullanıcı bekliyor |
| **Place ID ile detay çekme** | Senkron, güvenilir, standart |
| **Fotoğraf indirme** | Kalıcı photoRef, boyut kontrolü, çoklu fotoğraf |

### Katman 2 — DataForSEO (Enrichment Layer — Arka Plan)

| İşlem | Neden DataForSEO? |
|-------|-------------------|
| **Reviews (toplu çekme)** | 50-100 review × ~53x ucuz + çok daha zengin veri |
| **Rating distribution** | Google'da yok, DataForSEO'da dahil |
| **Popular times** | Google'da yok, DataForSEO'da dahil |
| **Place topics** | Google'da yok, otomatik etiket kaynağı |
| **Business attributes** | Google'da sınırlı, DataForSEO'da detaylı |
| **People also search** | Recommendation engine için |
| **Business description** | editorialSummary yerine — ücretsiz |
| **İşletme yanıtları** | UI zenginleştirme |
| **Import enrichment** | Standard queue (45dk OK), %77 maliyet düşüşü |

### Mimari Akış (Hibrit)

```
MEKAN EKLEME (Real-Time):
  URL → parseMapsUrl() → PlaceID/CID
  → Google Places API (Pro, $17/1K) → temel veri (isim, adres, konum, rating, foto)
  → Kaydet → Kullanıcıya hemen göster

ARKA PLAN ZENGİNLEŞTİRME (Async):
  Mekan kaydedildikten sonra → DataForSEO Task POST
    → My Business Info (CID ile) → rating_distribution, popular_times, place_topics, attributes, description
    → Reviews (depth: 50) → 50 review, işletme yanıtları, review fotoğrafları
  → Task GET (30dk içinde)
  → google_data JSONB güncelle (enriched alanlar)
  → UI: "Detaylı bilgi yükleniyor..." → "Hazır!" badge

IMPORT (Batch):
  CSV/GeoJSON → DataForSEO Standard Queue
    → Her mekan: $0.0015 (Google: $0.017)
    → %91 maliyet düşüşü
    → Async (45dk'ya kadar kabul edilebilir)
  → Enrichment tamamlanınca → toplu güncelleme
```

### Hibrit Maliyet Karşılaştırması

**Senaryo: 1 mekan ekleme (link) + enrichment**

| Adım | Provider | Maliyet |
|------|----------|---------|
| Place Details (real-time) | Google Pro | $0.017 |
| Photo download | Google Photos | $0.007 |
| Enrichment (background) | DataForSEO Standard | $0.0015 |
| 50 Reviews (background) | DataForSEO Standard | $0.00375 |
| **Toplam** | **Hibrit** | **$0.029** |

**Saf Google ile aynı veri:**

| Adım | Maliyet |
|------|---------|
| Place Details Pro | $0.017 |
| Photo | $0.007 |
| Reviews Enterprise (max 5!) | $0.020 |
| **Toplam** | **$0.044** — ve sadece 5 review! |

**→ Hibrit: %34 ucuz + 10x daha fazla review + rating distribution + popular times + topics + attributes**

**Senaryo: 100 mekan import**

| Yaklaşım | Maliyet | Review | Ek Veri |
|-----------|---------|--------|---------|
| **Saf Google** | $2.40 (detay+foto) + $2.00 (reviews, max 5/mekan) = **$4.40** | 500 review | ❌ |
| **Saf DataForSEO** | $0.54 (Live) veya $0.15 (Standard) + $0.375 (reviews 50/mekan) = **$0.525-$0.915** | 5,000 review | ✅ Tümü |
| **Hibrit** | Google $2.40 (real-time) + DataForSEO $0.525 (enrichment) = **$2.925** | 5,000 review | ✅ Tümü |

---

## 6. Uygulama Planı (Hibrit Strateji)

### Faz 1: DataForSEO Enrichment Service (2-3 gün)

**Yeni dosyalar:**
```
src/lib/dataforseo/
  ├── client.ts           # HTTP client (Basic Auth, base URL, error handling)
  ├── business-info.ts    # My Business Info Task POST/GET + Live
  ├── reviews.ts          # Reviews Task POST/GET
  ├── types.ts            # TypeScript interfaces for all responses
  └── enrichment.ts       # Orchestrator: enrich place with DataForSEO data
```

**Yeni API endpoint:**
```
POST /api/places/[id]/enrich    # Arka plan DataForSEO enrichment tetikle
GET  /api/places/[id]/enrich    # Enrichment durumu kontrol
```

**DB değişikliği:**
```sql
-- google_data JSONB'ye ek alanlar (migration gerekmez, JSONB esnek)
-- Enrichment sonrası şu alanlar eklenir:
{
  "rating_distribution": { "1": 12, "2": 8, "3": 45, "4": 156, "5": 890 },
  "popular_times": { "monday": [{ "hour": 12, "popular_index": 85 }, ...], ... },
  "place_topics": { "pasta": 45, "service": 38, "atmosphere": 29, ... },
  "attributes": { "wheelchair_accessible": true, "wifi": true, "outdoor_seating": true, ... },
  "business_description": "Family-owned Italian restaurant...",
  "book_online_url": "https://resy.com/...",
  "local_business_links": [{ "type": "menu", "url": "..." }, ...],
  "is_claimed": true,
  "current_status": "opened",
  "enriched_at": "2026-04-14T12:00:00Z",
  "enrichment_source": "dataforseo",
  "reviews_extended": [
    {
      "review_id": "...",
      "text": "...",
      "original_text": "...",
      "rating": 5,
      "author": "John D.",
      "author_reviews_count": 156,
      "local_guide": true,
      "timestamp": "2026-03-15T10:30:00Z",
      "owner_answer": "Thank you for your kind words!",
      "images": ["https://..."],
      "votes_count": 12
    },
    // ... 49 more reviews
  ]
}
```

**Usage tracking genişletme:**
```typescript
// track-usage.ts'e ek SKU'lar:
dataforseo_business_info: { name: "DataForSEO Business Info", costPer1k: 1.50, freeMonthly: 0 },
dataforseo_reviews: { name: "DataForSEO Reviews", costPer1k: 0.075, freeMonthly: 0 },
```

### Faz 2: UI Zenginleştirme (3-5 gün)

Enrichment verisi geldikten sonra mekan detay sayfasında:

| Widget | Veri Kaynağı | Açıklama |
|--------|-------------|----------|
| Rating Distribution Bar | `rating_distribution` | 1-5 yıldız bar chart (Google Play tarzı) |
| Popular Times Chart | `popular_times` | Gün + saat bazlı yoğunluk grafiği |
| Place Topics Cloud | `place_topics` | Tag cloud / chip listesi |
| Business Attributes | `attributes` | ✅/❌ ikonlu özellik listesi (wifi, wheelchair, vb.) |
| Aksiyon Butonları | `book_online_url`, `local_business_links` | "Rezervasyon Yap", "Menüyü Gör", "Sipariş Ver" |
| Extended Reviews | `reviews_extended` | 50 review, fotoğraflı, işletme yanıtlı, sıralanabilir |
| İşletme Açıklaması | `business_description` | editorialSummary yerine |
| Similar Places | `people_also_search` | "Benzer Mekanlar" önerisi |

### Faz 3: Import Pipeline Optimizasyonu (2-3 gün)

Import'u DataForSEO Standard Queue'ya taşımak:
- Maliyet %91 düşüş (100 mekan: $2.40 → $0.15)
- Ama async: kullanıcıya "Import başladı, hazır olunca bildirim alacaksınız" UX'i
- Notification sistemi (F-17) ile entegre

### Faz 4: AI Feature'lar İçin Veri Temeli (opsiyonel)

DataForSEO verisi AI feature'ları çok daha güçlü kılar:

| AI Feature | DataForSEO Katkısı |
|------------|-------------------|
| AI-04: Etiket Önerisi | `place_topics` + `attributes` → LLM'e bile gerek kalmadan otomatik etiket |
| AI-05: Review Özeti | 50 review (5 yerine) → çok daha zengin özet |
| AI-06: Sentiment | `rating_distribution` hazır veri + 50 review text analizi |
| AI-07: Recommendations | `people_also_search` → hazır benzer mekan listesi |
| AI-09: Trip Planner | `popular_times` → "11:00'da git, 14:00'da yoğun" bilgisi |

---

## 7. Karar Matrisi

| Kriter | Google Places API | DataForSEO | Hibrit ✅ |
|--------|-------------------|------------|-----------|
| Yanıt hızı | ✅ 100-300ms | ⚠️ 6-10sn (Live) | ✅ Google real-time + DataForSEO background |
| Maliyet (detay) | ❌ $17/1K | ✅ $1.50-5.40/1K | ✅ Google temel + DataForSEO enrichment |
| Maliyet (reviews) | ❌ $20/1K (5 review!) | ✅ $0.075/1K review | ✅ DataForSEO reviews |
| Review derinliği | ❌ Max 5 | ✅ Max 4,490 | ✅ DataForSEO |
| Veri zenginliği | ⚠️ Temel | ✅ Çok zengin | ✅ İkisinin birleşimi |
| Güvenilirlik | ✅ Resmi API | ⚠️ Scraping bazlı | ✅ Google fallback |
| ToS uyumu | ✅ Tam uyumlu | ⚠️ Gri bölge | ⚠️ DataForSEO kısmı risk |
| Fotoğraf kalitesi | ✅ Yüksek, çoklu | ⚠️ Tek, geçici URL | ✅ Google fotoğraf |
| Search yeteneği | ✅ Text Search | ⚠️ SERP bazlı | ✅ Google search |
| Minimum maliyet | ✅ Free tier | ❌ $50 minimum | ⚠️ $50 depozit gerekir |

---

## 8. Sonuç ve Tavsiye

### Kısa Vadeli Tavsiye: **Hibrit Strateji**

1. **Google Places API'yi koru** — mekan ekleme (link parse) ve fotoğraf indirme için ideal. Hız ve güvenilirlik kritik.

2. **DataForSEO'yu enrichment layer olarak ekle** — arka planda çalışsın:
   - Reviews: 50x daha fazla veri, 53x ucuz
   - Rating distribution, popular times, place topics: Google'da yok
   - Business description: editorialSummary alternatifi (ücretsiz!)
   - Attributes: otomatik etiket kaynağı

3. **Import pipeline'ında DataForSEO'yu tercih et** — %91 maliyet düşüşü, async model import için zaten uygun.

### Uzun Vadeli Tavsiye: **DataForSEO Ağırlığını Artır**

DataForSEO güvenilirliğini kanıtladıkça:
- Live endpoint'i mekan ekleme akışında da kullan (6-10sn loading kabul edilebilirse)
- Google Places API'yi sadece fallback olarak tut
- AI feature'ları DataForSEO'nun zengin verisi üzerine kur

### Kesinlikle Yapılmaması Gereken:

- ❌ Google Places API'yi tamamen bırakmak (hız ve güvenilirlik kaybı)
- ❌ Kullanıcı-facing real-time işlemlerde DataForSEO Standard/Priority kullanmak (çok yavaş)
- ❌ DataForSEO'ya %100 bağımlı olmak (scraping kesintisi riski)

---

## Ek: Hızlı Referans — DataForSEO API Çağrı Formatı

### Authentication
```
HTTP Basic Auth
Username: login@example.com
Password: api_password
Header: Authorization: Basic base64(username:password)
```

### My Business Info (Live)
```bash
curl -X POST "https://api.dataforseo.com/v3/business_data/google/my_business_info/live" \
  -H "Authorization: Basic [base64_credentials]" \
  -H "Content-Type: application/json" \
  -d '[{
    "keyword": "cid:194604053573767737",
    "location_code": 2840,
    "language_code": "en"
  }]'
```

### Reviews (Task POST)
```bash
curl -X POST "https://api.dataforseo.com/v3/business_data/google/reviews/task_post" \
  -H "Authorization: Basic [base64_credentials]" \
  -H "Content-Type: application/json" \
  -d '[{
    "cid": "194604053573767737",
    "location_code": 2840,
    "language_code": "en",
    "depth": 50,
    "sort_by": "newest"
  }]'
```

### Reviews (Task GET)
```bash
curl -X GET "https://api.dataforseo.com/v3/business_data/google/reviews/task_get/{task_id}" \
  -H "Authorization: Basic [base64_credentials]"
```

### Rate Limits
- Max 2000 API calls/minute (POST + GET combined)
- Max 100 tasks per POST request
- Results available for 30 days after task creation
