# Map Organiser — Feature Suggestions v3

> **Tarih:** 2026-04-17
> **Kaynak:** Full codebase audit (feat/dataforseo-provider branch), system_v2.md, feature-suggestions_v2.md, system-design_v2.md
> **Yöntem:** Mevcut codebase'in tüm modülleri, API route'ları, hook'ları, store'ları, component'ları ve veritabanı şeması analiz edilerek; v2'de önerilen ve implemente edilen feature'ların üzerine yeni öneriler üretilmiştir.
>
> **v2'den farklar:**
> - v2'de **28 öneri** vardı (18 non-AI + 10 AI). Bu döküman **52 öneri** içerir (25 non-AI + 27 AI).
> - v2'de implemente edilen 8 feature (F-02, F-06, F-07, F-09, F-10, F-11a, F-14, Batch Import) bu dökümanda "✅ v2'de implemente" olarak işaretlenmiştir.
> - v2'de önerilip henüz implemente edilmeyen feature'lar "🔄 v2'den devir" olarak işaretlenmiştir.
> - Tamamen yeni öneriler "🆕 Yeni" olarak işaretlenmiştir.

---

## Doküman Yapısı

```
PART 1 — v2 İmplementasyon Durumu (Özet)
PART 2 — Non-AI Features (F-01 → F-25)
  Group A: Core UX & Interaction
  Group B: Map & Visualization
  Group C: Organization & Planning
  Group D: Social & Sharing
  Group E: Data Management & Analytics
  Group F: Content & Media
  Group G: Platform Expansion
  Group H: Monetization & Growth
PART 3 — AI & LLM Features (AI-01 → AI-27)
  Group I:  Intelligent Search & Interaction
  Group J:  Smart Categorization & Tagging
  Group K:  Content Generation & Analysis
  Group L:  Discovery & Recommendation
  Group M:  AI-Powered Planning
  Group N:  Visual Intelligence & Media
  Group O:  AI Agents & Automation
  Group P:  Social & Personalization AI
  Group Q:  AI Infrastructure & Platform
PART 4 — Priority Matrix & Roadmap
PART 5 — Cross-Cutting Technical Concerns
PART 6 — AI Detaylı Maliyet & Mimari Analiz
```

---

# PART 1 — v2 İMPLEMENTASYON DURUMU

> v2'de önerilen 28 feature'ın güncel durumu.

## ✅ İmplemente Edilenler (8/28)

| ID | Feature | Commit/Branch | Kapsam Notu |
|----|---------|---------------|-------------|
| F-02 | Mekan Sıralama | `a2f9a2d` | 6 kriter, URL persistence |
| F-06 | Dark Mode & Tema | `d8b9385` | next-themes, 6 harita stili, oklch CSS vars |
| F-07 | Custom Map Markers | `df0b442` | Canvas hybrid, 12 Lucide ikon, dots/icons toggle |
| F-09 | Drag & Drop Liste Sıralama | `28e5cf3` | @dnd-kit, sort_order, GripVertical |
| F-10 | Trip Planner & Route | `8248510` | K-means auto-plan, Mapbox Directions, timeline+map |
| F-11a | Public Sharing Links | `34db641` | nanoid slug, service role, list+trip paylaşımı |
| F-14 | İstatistik Dashboard | `d9f2550` | Recharts, 6 widget, parallel queries |
| — | Batch Import Rewrite | `6d68139` | Zustand, parse/batch endpoints, background reviews |

## 🔄 v2'den Devir (Henüz İmplemente Edilmemiş) (20/28)

| ID | Feature | v3'teki Yeni ID | Durum |
|----|---------|-----------------|-------|
| F-01 | Manuel Mekan Ekleme | F-01 | Aynen devir, güncellenmiş spec |
| F-03 | Kayıtlı Filtreler | F-03 | Aynen devir |
| F-04 | Mekan Karşılaştırma | F-04 | Aynen devir |
| F-05 | Quick Add (Voice) | F-05 | Aynen devir |
| F-08 | Nearby Search + Proximity | F-08 | Aynen devir |
| F-11b | Collaborative Lists | F-11 | Genişletildi (collaborative trips dahil) |
| F-12 | Export & Backup | F-06 | Aynen devir, KML eklendi |
| F-13 | Duplikat Tespiti | F-12 | Aynen devir |
| F-15 | Rich Notes & User Media | F-13 | Aynen devir |
| F-16 | Aktivite Logu | F-14 | Aynen devir |
| F-17 | Bildirimler | F-15 | Genişletildi |
| F-18 | i18n | F-16 | Aynen devir |
| AI-01 | Doğal Dil Filtreleme | AI-01 | Aynen devir |
| AI-02 | Mekan Chatbot | AI-02 | Genişletildi (Agentic) |
| AI-03 | Akıllı Kategorilendirme | AI-03 | Aynen devir |
| AI-04 | Etiket Önerisi | AI-04 | Aynen devir |
| AI-05 | Review Özeti | AI-05 | Aynen devir |
| AI-06 | Sentiment Analizi | AI-06 | Aynen devir |
| AI-07 | Recommendation Engine | AI-07 | Genişletildi (Multi-signal) |
| AI-08 | Akıllı Import | AI-08 | Aynen devir |
| AI-09 | AI Trip Planner | AI-09 | Genişletildi (Multi-modal) |
| AI-10 | Görsel Tanıma | AI-10 | Aynen devir |

---

# PART 2 — NON-AI FEATURES

---

## Group A: Core UX & Interaction

### F-01: Manuel Mekan Ekleme (Drop Pin / Address Search) 🔄 v2'den devir

**v2 Referans:** F-01 — spec aynen geçerli.

**Ne:** Haritaya tıklayarak veya adres yazarak Google Maps linki olmadan mekan ekleme.

**v3 Güncellemesi:**
- Mevcut `AddPlaceDialog` zaten link-based ekleme yapıyor → yeni tab: "Pin on Map" + "Search Address"
- Mapbox Geocoding API (`/geocoding/v5/mapbox.places/`) mevcut token ile kullanılabilir
- `places.source` enum'a `'manual_pin'` + `'address_search'` eklenir
- **Yeni:** Reverse geocoding sonucundan DataForSEO ile opsiyonel enrichment → "Bu mu demek istediğiniz?" önerisi

**Effort:** 3-5 gün | **Impact:** 🔥🔥🔥

---

### F-02: Mekan Sıralama ✅ v2'de implemente

6 sıralama kriteri, URL persistence, FilterPanel/FilterSheet/header entegrasyonu. Tamamlandı.

---

### F-03: Gelişmiş Arama & Kayıtlı Filtreler 🔄 v2'den devir

**v2 Referans:** F-03 — spec aynen geçerli.

**Ne:** Sık kullanılan filtre kombinasyonlarını preset olarak kaydetme.

**v3 Güncellemesi:**
- 9 filtre parametresi + 6 sort seçeneği = büyük kombinasyon alanı
- `saved_filters` tablosu (user_id, name, filter_json, created_at)
- FilterPanel üstüne "💾 Save" + preset chip'leri
- **Yeni:** AI-01 (doğal dil filtreleme) ile entegre: "Bu sorguyu kaydet" butonu

**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### F-04: Mekan Karşılaştırma (Side-by-Side) 🔄 v2'den devir

**v2 Referans:** F-04 — spec aynen geçerli.

**Ne:** 2-4 mekanı tablo formatında yan yana karşılaştırma.

**v3 Güncellemesi:**
- Mevcut `selectedPlaceIds: Set<string>` bulk select altyapısı hazır
- BulkActionBar'a "Compare" butonu (2-4 seçim olduğunda aktif)
- `/places/compare?ids=uuid1,uuid2,uuid3`
- **Yeni:** DataForSEO'dan gelen `rating_distribution`, `popular_times` verisi karşılaştırmayı zenginleştirir
- **Yeni:** AI-15 (AI karşılaştırma analizi) ile entegre edilebilir

**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### F-05: Quick Add — Voice & Shortcuts 🔄 v2'den devir

**v2 Referans:** F-05 — spec aynen geçerli.

**v3 Güncellemesi:**
- Web Speech API ile sesle mekan adı dikte
- iOS/Android shortcut entegrasyonu: custom URL scheme
- "Quick Save" modu: mevcut konum + tarih + "Want to Go"
- **Yeni:** Mevcut PWA Share Target (`/api/share-target`) altyapısı zaten var → bununla entegre edilebilir

**Effort:** 3-5 gün | **Impact:** 🔥🔥

---

### F-07: Web Clipper / Browser Extension 🆕 Yeni

**Ne:** Chrome/Firefox/Safari extension ile herhangi bir web sayfasından mekan kaydetme.

**Neden:**
- Kullanıcılar mekanları sadece Google Maps'te değil, Instagram, TripAdvisor, Yelp, blog yazılarında keşfediyor
- Extension ile bir blog yazısındaki restoran adresini tek tıkla kaydetme
- Mevcut `parse-link` API'si Google Maps URL'lerini parse ediyor → extension bunu genelleştirir
- "Gördüğün yerde kaydet" UX'i → friction'ı minimize eder

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Chrome Extension** | Manifest V3, popup UI (React), content script (sayfa URL + meta parse) |
| **Sayfa Analizi** | Content script → mekan adı (og:title, h1), adres (schema.org/Place, microdata), koordinat (meta geo tags) |
| **API Entegrasyonu** | Extension → POST `/api/places/from-web` → DataForSEO/Google enrichment |
| **Quick Save** | Popup'ta: isim, kategori, notlar (opsiyonel) → tek tıkla kaydet |
| **Safari** | Safari Web Extension (aynı manifest) → iOS Safari'de de çalışır |

**Gelişmiş Özellikler:**
- Sayfa içi mekan adlarını highlight → sağ tık "Save to Map Organiser"
- Instagram/TikTok video'dan mekan tespit (AI-10 ile entegre)
- TripAdvisor/Yelp sayfalarından otomatik mekan verisi çıkarma

**Effort:** Orta-Yüksek (5-8 gün) — Extension geliştirme + API endpoint + review süreci.

**Impact:** 🔥🔥🔥 — Mekan ekleme friction'ını dramatik azaltır. Growth channel.

---

## Group B: Map & Visualization

### F-06: Export & Backup 🔄 v2'den devir (eski F-12)

**v2 Referans:** F-12 — spec aynen geçerli.

**Ne:** Mekanları CSV, JSON, GeoJSON, KML formatlarında dışa aktarma.

**v3 Güncellemesi:**
- Mevcut filtreler uygulanır (ülke, şehir, kategori, vb.)
- **Yeni:** Trip export (PDF itinerary): trip günleri + mekanlar + harita screenshot → indirilebilir PDF
- **Yeni:** Periyodik backup: Vercel Cron → haftalık JSON → Supabase Storage
- **Yeni:** Apple Maps / Google My Maps direkt import formatı

**Effort:** 2-4 gün | **Impact:** 🔥🔥🔥

---

### F-08: Konum Zekası (Nearby + Proximity) 🔄 v2'den devir

**v2 Referans:** F-08 — spec aynen geçerli.

**v3 Güncellemesi:**
- PostGIS `ST_DWithin` ile nearby filtre
- PWA foreground proximity check (30s interval)
- **Yeni:** Mevcut viewport filtering (`bounds` parametresi) nearby search ile birleştirilebilir
- **Yeni:** "Walking distance" filtre (Mapbox Directions API isochrone: 5/10/15 dk yürüme mesafesi)

**Effort:** Nearby: 1-2 gün, Proximity: 3-4 gün | **Impact:** 🔥🔥🔥

---

### F-09: Harita Heatmap & Yoğunluk Görselleştirme 🆕 Yeni

**Ne:** Mekan yoğunluğunu ısı haritası olarak gösterme. Ziyaret edilmiş mekanların coğrafi dağılımını görselleştirme.

**Neden:**
- 200+ mekan olan kullanıcılar haritada "nerede yoğunlaştığımı" göremiyorlar
- "İstanbul'un hangi semtlerini keşfettim?" sorusuna görsel cevap
- Gamification: "Kapladığın alan" metriki
- Mevcut Mapbox GL heatmap layer desteği native

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Mapbox Heatmap Layer** | `heatmap` layer type, `heatmap-weight` = 1, `heatmap-intensity` zoom'a bağlı, `heatmap-radius` = 30-80px |
| **Toggle** | MapView'da "Heatmap" toggle butonu (mevcut marker dots/icons toggle'ın yanında) |
| **Filtre Entegrasyonu** | Sadece filtrelenmiş mekanların heatmap'i (visited, want_to_go, vs.) |
| **Visit Status Renklendirme** | visited=yeşil, want_to_go=mavi, favorite=altın → farklı heatmap overlay'ler |
| **"Coverage" Metriği** | S2 geometry ile kaç farklı cell ziyaret edilmiş → Stats dashboard'a eklenir |

**Gelişmiş Özellikler:**
- Zaman bazlı animasyon: 2024 → 2025 → 2026 ekleme animasyonu
- Şehir bazlı coverage yüzdesi: "İstanbul %34 keşfedildi"
- Export: heatmap'i PNG/SVG olarak kaydet (paylaşım için)

**Effort:** Orta (3-5 gün)

**Impact:** 🔥🔥🔥 — "Wow" efekti yüksek. Gamification + paylaşılabilir içerik.

---

### F-10: Gelişmiş Harita Etkileşimleri 🆕 Yeni

**Ne:** Haritada çizim araçları (alan seçimi, custom bölge), 3D bina görünümü, harita notları.

**Neden:**
- "Bu bölgedeki mekanları seç" → lasso selection
- 3D bina görünümü (Mapbox GL 3D buildings) seyahat planlamasını zenginleştirir
- Haritaya notlar/etiketler ekleme ("Bu sokak çok güzel", "Burası pahalı bölge")

**Alt Özellikler:**

**a) Lasso / Area Selection:**
- Haritada serbest çizim → seçili alan içindeki mekanlar otomatik seçilir
- Mevcut bulk actions (delete, tag, add-to-list) seçili mekanlarla çalışır
- Mapbox Draw GL kullanılabilir

**b) 3D Buildings:**
- `fill-extrusion` layer → Mapbox 3D buildings
- Pitch control: 0° (düz) → 60° (eğik) slider
- Trip planlarken bina yüksekliklerini görmek → "rooftop bar şurada"

**c) Map Annotations:**
- Kullanıcı haritaya text/emoji pin bırakabilir
- DB: `map_annotations` tablosu (user_id, location, text, emoji, created_at)
- Paylaşılan haritalarda da görünür (F-11a)

**Effort:** Lasso: 2-3 gün, 3D: 1-2 gün, Annotations: 3-4 gün

**Impact:** 🔥🔥 — Power user'lar için değerli, casual kullanıcılar fark etmeyebilir.

---

## Group C: Organization & Planning

### F-11: Collaborative Lists & Trips 🔄 v2'den devir (genişletildi)

**v2 Referans:** F-11b — sadece collaborative lists vardı, şimdi trips da dahil.

**Ne:** Liste ve trip'leri diğer kullanıcılarla view/edit izinli paylaşma. Gerçek zamanlı eşzamanlı düzenleme.

**v3 Güncellemesi:**
- `list_shares` + `trip_shares` junction tabloları
- **Yeni:** Supabase Realtime ile eşzamanlı düzenleme bildirimi
- **Yeni:** Trip'lerde "voting" özelliği: her katılımcı mekanlara oy verir → en çok oy alan mekanlar plana girer
- **Yeni:** Invite link mekanizması (mevcut shared_links altyapısını genişlet)
- **Yeni:** "Presence" göstergesi: kim çevrimiçi ve nereye bakıyor

**Teknik:**
```sql
CREATE TABLE trip_shares (
  trip_id uuid REFERENCES trips ON DELETE CASCADE,
  shared_with_user_id uuid REFERENCES auth.users,
  permission text DEFAULT 'view', -- 'view' | 'edit' | 'admin'
  invited_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, shared_with_user_id)
);

CREATE TABLE place_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips ON DELETE CASCADE,
  place_id uuid REFERENCES places,
  user_id uuid REFERENCES auth.users,
  vote smallint DEFAULT 1, -- 1 = up, -1 = down
  created_at timestamptz DEFAULT now(),
  UNIQUE(trip_id, place_id, user_id)
);
```

**Effort:** Yüksek (8-12 gün)

**Impact:** 🔥🔥🔥 — Viral büyüme kanalı. Grup seyahati planlaması unique değer.

---

### F-12: Duplikat Tespiti & Birleştirme 🔄 v2'den devir (eski F-13)

**v2 Referans:** F-13 — spec aynen geçerli.

**Effort:** 4-5 gün | **Impact:** 🔥🔥

---

### F-13: Rich Notes & User Media 🔄 v2'den devir (eski F-15)

**v2 Referans:** F-15 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** Tiptap yerine **Novel** editor önerilir (shadcn uyumlu, daha lightweight)
- **Yeni:** Voice memo ekleme (Web Audio API → Supabase Storage)
- **Yeni:** User fotoğrafları + Google fotoğrafları aynı galeri grid'de gösterilir

**Effort:** 4-6 gün | **Impact:** 🔥🔥

---

### F-14: Aktivite Logu & Mekan Geçmişi 🔄 v2'den devir (eski F-16)

**v2 Referans:** F-16 — spec aynen geçerli.

**Effort:** 3-4 gün | **Impact:** 🔥

---

## Group D: Social & Sharing

### F-15: Bildirimler & Hatırlatıcılar 🔄 v2'den devir (genişletildi, eski F-17)

**v2 Referans:** F-17 — genişletildi.

**v3 Güncellemesi:**
- Temel özellikler aynen (reservation_date, push notification, in-app notification center)
- **Yeni:** Trip countdown: "İstanbul trip'ine 5 gün kaldı" → push
- **Yeni:** AI-powered smart reminders (AI-20 ile entegre): "6 aydır gitmediğin favori cafeler" önerisi
- **Yeni:** Weekly digest email: bu hafta eklenenler + yaklaşan trip'ler
- **Yeni:** Shared list/trip bildirimleri: "Ahmet listeye yeni mekan ekledi"

**Effort:** Push: 5-7 gün, In-app: 3-4 gün | **Impact:** 🔥🔥

---

### F-16: Çoklu Dil Desteği (i18n) 🔄 v2'den devir (eski F-18)

**v2 Referans:** F-18 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** AI ile dinamik çeviri önerisi (AI-22 ile entegre): kullanıcı dilini algıla → UI dili öner
- **Yeni:** Mekan isim transliterasyonu: Japonca/Korece/Arapça mekan isimleri → latin alfabe

**Effort:** 5-8 gün | **Impact:** 🔥

---

### F-17: Sosyal Keşif & Aktivite Akışı 🆕 Yeni

**Ne:** Takip sistemi, aktivite feed'i, mekan önerisi paylaşma, leaderboard.

**Neden:**
- Mevcut uygulama tamamen "solo" — kullanıcılar birbirini göremez
- F-11a (public sharing) viral potansiyel yaratıyor ama tek yönlü
- "Arkadaşım İstanbul'da nereye gidiyor?" → sosyal keşif motivasyonu
- Retention: günlük olarak feed'e bakmak için geri gelme

**Alt Özellikler:**

**a) Takip Sistemi:**
```sql
CREATE TABLE follows (
  follower_id uuid REFERENCES auth.users,
  following_id uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);
```
- Profil sayfası: kullanıcının public mekan istatistikleri + paylaştığı listeler
- Takip butonu (Twitter/Instagram benzeri)

**b) Aktivite Feed:**
- `/feed` sayfası: takip edilen kullanıcıların aktiviteleri
- Aktivite tipleri: yeni mekan ekledi, yeni trip oluşturdu, liste paylaştı, mekan ziyaret etti
- Feed sort: kronolojik (en yeni ilk)

**c) Mekan Önerisi (Direct):**
- "Bu mekanı [kullanıcı]'ya öner" butonu → in-app mesaj
- "Ozan sana [Karaköy Güllüoğlu] mekanını önerdi" → notification

**d) Leaderboard:**
- Haftalık: en çok mekan ekleyen, en çok ülke, en çok ziyaret
- Opsiyonel (privacy seçeneği)

**Effort:** Yüksek (10-15 gün) — Yeni entity'ler, feed algoritması, profil sayfası, notification entegrasyonu.

**Impact:** 🔥🔥🔥 — Viral büyüme + retention. Instagram/social katmanı.

---

### F-18: Calendar Entegrasyonu 🆕 Yeni

**Ne:** Trip planlarını Google Calendar / Apple Calendar ile senkronize etme.

**Neden:**
- Trip Planner güçlü ama dışarıda izole — kullanıcı planı takviminde göremez
- "3 Mayıs'ta 14:00'te Topkapı Sarayı" → takvime otomatik etkinlik
- Reservation date'ler → takvim hatırlatıcıları
- CalDAV/iCal standart protokolleri ile geniş uyumluluk

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **iCal Export** | `/api/trips/[id]/ical` → .ics dosyası indirme |
| **Google Calendar API** | OAuth2 ile yetkilendirme → etkinlik oluşturma |
| **Subscription URL** | Trip için CalDAV subscription URL → takvim otomatik güncellenir |
| **Two-way sync** | Takvimde değişiklik → trip güncelleme (ileri aşama) |

**iCal Formatı:**
```
BEGIN:VEVENT
DTSTART:20260503T140000
DTEND:20260503T160000
SUMMARY:Topkapı Sarayı
LOCATION:Cankurtaran, 34122 Fatih/İstanbul
DESCRIPTION:Trip: 3 Günlük İstanbul - Gün 1
GEO:41.0115;28.9833
END:VEVENT
```

**Effort:** iCal export: 1-2 gün, Google Calendar: 3-5 gün, Two-way: 7-10 gün.

**Impact:** 🔥🔥 — Trip planlamasını gerçek hayata bağlar.

---

## Group E: Data Management & Analytics

### F-19: Gelişmiş İstatistik & Insight'lar 🆕 Yeni

**Ne:** Mevcut stats dashboard'un genişletilmesi: harcama takibi, ziyaret hedefleri, karşılaştırmalı dönemler, mekan coğrafi diversite skoru.

**Neden:**
- Mevcut dashboard (F-14) 6 widget ile temel istatistikleri gösteriyor
- "Bu ay geçen aya göre ne kadar aktiftim?" → trend karşılaştırma eksik
- "Hangi kategoriye en çok para harcadım?" → finansal insight eksik
- Gamification derinleştirme: hedefler, streak'ler, başarımlar

**Alt Özellikler:**

**a) Harcama Takibi:**
- `places` tablosuna `spent_amount decimal` + `currency text` kolonu
- Mekan detayda "Ne kadar harcadım?" input
- Stats'ta: toplam harcama, kategori bazlı harcama, aylık trend
- Trip bazlı bütçe: planlanan vs. gerçekleşen

**b) Ziyaret Hedefleri & Streak:**
- Haftalık/aylık hedef: "Bu ay 5 yeni yer ziyaret et"
- Streak: ardışık gün/hafta ziyaret serisi
- UI: Stats'ta progress bar + flame ikonu

**c) Karşılaştırmalı Dönemler:**
- "Bu ay vs. geçen ay" toggle
- "2025 vs. 2026" yıllık karşılaştırma
- Delta göstergeler (↑12%, ↓3%)

**d) Geografik Diversite Skoru:**
- Kaç farklı ülke/şehir/semt ziyaret edilmiş
- S2 cell coverage → "Dünya haritası doluluk yüzdesi"
- Unlockable badges: "5 kıta", "20 ülke", "50 şehir"

**Effort:** Orta-Yüksek (6-9 gün)

**Impact:** 🔥🔥🔥 — Gamification + retention. Paylaşılabilir istatistikler = viral growth.

---

### F-20: Offline Modu & Gelişmiş PWA 🆕 Yeni

**Ne:** İnternet olmadan mekan görüntüleme, trip planına bakma, offline ekleme.

**Neden:**
- `sw.js` ve PWA manifest mevcut ama cache stratejisi minimal
- Seyahatte internet her zaman mevcut değil (uçak modu, yurtdışı roaming)
- "Trip planıma bakamıyorum çünkü internet yok" → kritik kullanım senaryosu
- Mapbox GL offline tiles desteği (v3+) mevcut

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **Service Worker Cache** | Cache-first stratejisi: `/api/places`, `/api/trips/[id]`, static assets |
| **IndexedDB** | Workbox + idb-keyval: mekan listesi, trip detayları, filtre state |
| **Offline Map Tiles** | Mapbox GL `offlineManager.createPack()` → seçili bölgenin tile cache'i |
| **Offline Ekleme** | Yeni mekan → IndexedDB queue → çevrimiçi olunca sync |
| **Sync Engine** | Background Sync API → queue'daki işlemleri gönder |
| **Conflict Resolution** | Last-write-wins (basit) veya timestamp bazlı merge (ileri aşama) |

**UI:**
- Settings > "Offline Data" bölümü: hangi trip'leri/listeleri offline yap
- OfflineBanner zaten mevcut (layout'ta) → "Offline moddasınız. Değişiklikler senkronize edilecek."
- Map: offline tile bölgesi seçimi (kutu çiz → indir)

**Effort:** Yüksek (8-12 gün) — Cache stratejisi, sync engine, conflict resolution.

**Impact:** 🔥🔥🔥 — Seyahat uygulaması için kritik. "İnternet olmadan da çalışır" güçlü bir değer önerisi.

---

### F-21: Gelişmiş Place Detail Sayfası 🆕 Yeni

**Ne:** Mekan detay sayfasını zenginleştirme: opening hours widget, popular times grafiği, fotoğraf galerisi, ilgili mekanlar.

**Neden:**
- DataForSEO'dan `popular_times`, `opening_hours`, `rating_distribution`, `place_topics` verisi zaten geliyor (google_data JSONB)
- Bu veri UI'da yeterince kullanılmıyor
- Place detail sayfası şu an: fotoğraf + temel bilgi + reviews
- Zenginleştirilmiş detay sayfası → Google Maps alternatifi hissi

**Alt Özellikler:**

**a) Opening Hours Widget:**
- Bugünkü durum: Açık (yeşil) / Kapalı (kırmızı) badge
- Haftalık çalışma saatleri tablosu
- "Şu an açık mı?" hesaplaması (client-side timezone)

**b) Popular Times Grafiği:**
- DataForSEO `popular_times` verisi → bar chart (saatlik yoğunluk)
- "Şu an kalabalık mı?" göstergesi
- Recharts ile görselleştirme (mevcut kütüphane)

**c) Fotoğraf Galerisi:**
- Grid layout (şu an tek fotoğraf)
- DataForSEO'dan birden fazla fotoğraf URL'si (varsa)
- Lightbox görüntüleme (tıkla → büyüt)

**d) İlgili Mekanlar:**
- Aynı kategorideki nearby mekanlar (PostGIS)
- "Benzer mekanlarınız" (AI-07 ile entegre)

**e) Place Topics:**
- DataForSEO `place_topics` → tag cloud veya pill'ler
- "live music", "outdoor seating", "good for groups" gibi

**Effort:** Orta (4-6 gün)

**Impact:** 🔥🔥🔥 — Mevcut verinin değerini ortaya çıkarır. Düşük yatırım, yüksek algılanan kalite.

---

## Group F: Content & Media

### F-22: Seyahat Günlüğü (Travel Journal) 🆕 Yeni

**Ne:** Trip'lere gün bazlı notlar, fotoğraflar ve anılar ekleme. Blog formatında görüntülenebilir/paylaşılabilir.

**Neden:**
- Trip'ler şu an "plan" ağırlıklı (gelecek odaklı) — "anı" boyutu eksik
- "Geçen yaz İstanbul trip'inde neler yaptık?" → görsel/yazılı kayıt
- Public sharing (F-11a) ile paylaşılan trip journal = organik büyüme kanalı
- Polarsteps, TripIt gibi rakiplerin ana özelliği

**Teknik Uygulama:**

| Katman | Detay |
|--------|-------|
| **DB** | `trip_day_places.journal_text` (rich text), `trip_day_places.journal_photos` (JSONB: storage paths) |
| **UI** | Trip timeline'da her mekanda "Add journal entry" butonu |
| **Editor** | Minimal rich text (Novel/Tiptap) + fotoğraf yükleme |
| **Public View** | `/shared/[slug]` → journal görünümü (blog format) |
| **Export** | PDF export: fotoğraf + metin + harita → seyahat hatıra kitabı |

**Effort:** Orta-Yüksek (6-8 gün)

**Impact:** 🔥🔥🔥 — Uygulamayı "planlama aracı"ndan "seyahat deneyimi platformu"na dönüştürür.

---

## Group G: Platform Expansion

### F-23: Native Mobile App (React Native / Expo) 🆕 Yeni

**Ne:** iOS ve Android için native mobil uygulama.

**Neden:**
- PWA sınırlamaları: background location, push notification güvenilirliği, app store keşfedilebilirliği
- F-08b (Proximity Alerts) ve F-20 (Offline) native'de çok daha güçlü
- App Store/Play Store varlığı → güvenilirlik + keşfedilebilirlik
- Camera API (AI-10 Vision) native'de daha iyi deneyim

**Teknik Yaklaşım:**

| Seçenek | Artı | Eksi | Öneri |
|---------|------|------|-------|
| **React Native + Expo** | Mevcut React bilgisi transfer, Expo EAS Build | Mapbox GL native SDK farklı | ✅ Önerilen |
| **Expo Router** | File-based routing (Next.js benzeri) | Yeni ekosistem | ✅ Önerilen |
| **Flutter** | Performans, tek codebase | Dart öğrenme maliyeti | ❌ |
| **PWA devam** | Sıfır maliyet | Sınırlı native erişim | Kısa vade |

**Mimari:**
- Shared: Supabase client, API types, Zod schemas, business logic
- Native: Navigation (Expo Router), MapView (react-native-mapbox-gl), UI (NativeWind / Tamagui)
- Mono-repo: Turborepo ile web + mobile aynı repo

**Effort:** Çok Yüksek (30-60 gün) — Yeni proje, ama shared logic ile hızlandırılabilir.

**Impact:** 🔥🔥🔥 — Platform genişletme. App Store varlığı. Background features.

---

### F-24: Itinerary Template Marketplace 🆕 Yeni

**Ne:** Hazır seyahat planı şablonları: "3 Günlük İstanbul", "Roma Yemek Turu", "Tokyo Seyahat Planı".

**Neden:**
- Yeni kullanıcılar için "soğuk başlangıç" problemi — boş uygulama, ne yapacağını bilmiyor
- Şablonlar → anında değer algısı + kullanım motivasyonu
- "Başka kullanıcıların planlarını keşfet" → sosyal keşif (F-17 ile entegre)
- İçerik oluşturucular (travel bloggers) için platform = organik büyüme

**Teknik Uygulama:**
```sql
CREATE TABLE trip_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES auth.users,
  name text NOT NULL,
  city text,
  country text,
  duration_days integer,
  description text,
  cover_image text, -- storage path
  tags text[],      -- 'budget', 'luxury', 'food', 'culture'
  is_featured boolean DEFAULT false,
  use_count integer DEFAULT 0,
  rating_avg decimal,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE trip_template_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES trip_templates ON DELETE CASCADE,
  day_number integer,
  theme text,
  places jsonb -- [{name, lat, lng, category, note}]
);
```

**UI:**
- `/templates` veya `/explore` sayfası
- Kategori: şehir, süre, tema (yemek, kültür, doğa, bütçe)
- "Use this template" → trip_days otomatik oluştur + mekanları ekle
- "Customize" → trip editor'de düzenle

**Effort:** Orta-Yüksek (6-10 gün)

**Impact:** 🔥🔥🔥 — Onboarding çözümü + community content + viral growth.

---

## Group H: Monetization & Growth

### F-25: Premium Subscription & Paywall 🆕 Yeni

**Ne:** Freemium model: temel özellikler ücretsiz, premium özellikler (AI, sınırsız export, advanced stats) abonelik ile.

**Neden:**
- AI feature'ların sunucu maliyeti var (~$17.40/ay per 100 user)
- Sürdürülebilir büyüme için gelir modeli gerekli
- "Free with limits" → "Pay for power" doğal geçiş
- Rakip karşılaştırma: Wanderlog Premium $50/yıl, TripIt Pro $49/yıl

**Tier Yapısı:**

| Özellik | Free | Pro ($4.99/ay) | Team ($9.99/ay) |
|---------|------|----------------|-----------------|
| Mekan limiti | 200 | Sınırsız | Sınırsız |
| Trip limiti | 3 | Sınırsız | Sınırsız |
| AI sorgular/ay | 20 | Sınırsız | Sınırsız |
| Export formatları | JSON | Tüm formatlar | Tüm formatlar |
| Collaborative lists | — | ✅ | ✅ |
| Priority enrichment | — | ✅ | ✅ |
| Custom map styles | — | ✅ | ✅ |
| Team members | — | — | 5 |
| API erişimi | — | — | ✅ |

**Teknik:**
- Stripe veya Lemon Squeezy entegrasyonu
- `profiles.subscription_tier` (free | pro | team)
- `profiles.subscription_expires_at` timestamptz
- Middleware'de tier kontrolü → paywall dialog
- Vercel Marketplace'den billing entegrasyonu

**Effort:** Yüksek (8-12 gün) — Stripe entegrasyonu, paywall logic, subscription management.

**Impact:** 🔥🔥🔥 — Sürdürülebilir iş modeli. AI maliyet karşılama.

---

# PART 3 — AI & LLM FEATURES

> **v3 AI Vizyonu:** v2'deki 10 AI feature'a ek olarak 17 yeni AI önerisi. Toplam 27 AI feature.
> Odak noktaları: agentic AI, multi-modal, personalization, automation.

> **Ortak Mimari Kararlar** (v2'den güncellendi):
> - **LLM Provider:** Claude API (Haiku 4.5: günlük işlemler, Sonnet 4.6: karmaşık reasoning, Opus 4.6: agentic workflows)
> - **Integration:** Vercel AI SDK v6 (useChat, useCompletion, streamText, generateObject, tool calling)
> - **API Key Stratejisi:** Server-side tek key (başlangıç) → hybrid (premium: own key, free: server key + limit)
> - **Cache:** `google_data` JSONB'ye `ai_*` prefix'li alanlar + Redis/Edge Config (hot data)
> - **Rate Limit:** Free: 20 AI istek/ay, Pro: sınırsız
> - **Fallback:** AI başarısız → rule-based devam
> - **Observability:** Vercel AI Gateway ile model usage + latency + cost tracking

---

## Group I: Intelligent Search & Interaction

### AI-01: Doğal Dil ile Filtreleme & Sorgulama 🔄 v2'den devir

**v2 Referans:** AI-01 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** Zaman ifadeleri parse: "geçen hafta", "mayıs ayı", "dün" → tarih aralığı
- **Yeni:** Compound sorgular: "İstanbul'da dün eklediğim 4+ puanlı barları favorilerime ekle" → filtre + action
- **Yeni:** Sonuç yoksa → "Bu kriterlere uygun mekan bulunamadı. Filtreleri gevşetmek ister misin?"
- **Yeni:** Query history (localStorage): son 10 AI sorgu → hızlı erişim

**Model:** Claude Haiku 4.5
**Maliyet:** ~$0.0005/sorgu
**Effort:** 2-3 gün | **Impact:** 🔥🔥🔥

---

### AI-02: Agentic Mekan Asistanı (Conversational Discovery) 🔄 v2'den devir (genişletildi)

**v2 Referans:** AI-02 — Chatbot'tan Agentic asistana genişletildi.

**Ne:** Multi-turn sohbet + tool calling ile kullanıcının mekanları üzerinde aksiyon alabilen AI asistan.

**v3 Farkları (v2'den):**
- v2: Sadece sorgulama + öneri → v3: **Aksiyon alma** (mekan ekleme, trip oluşturma, tag atama)
- v2: useChat() → v3: **Agent loop** (Vercel AI SDK tool calling + multi-step reasoning)
- v2: Son 10 mesaj context → v3: **Persistent memory** (conversation_id bazlı)
- v2: Tek model → v3: **Model routing** (basit sorgu → Haiku, karmaşık → Sonnet)

**Tool Tanımları (Claude Tool Use):**

| Tool | Açıklama | Örnek Kullanım |
|------|----------|----------------|
| `search_places` | Filtreli mekan arama | "İstanbul'daki kafeler" |
| `get_place_detail` | Tek mekan detayı | "Karaköy Güllüoğlu'nun puanı?" |
| `create_place` | Yeni mekan ekleme | "X mekanını ekle" |
| `update_place` | Mekan güncelleme | "Bunu visited yap" |
| `add_to_list` | Listeye ekleme | "Bunu İstanbul listemize ekle" |
| `create_trip` | Trip oluşturma | "3 günlük plan yap" |
| `get_stats` | İstatistik sorgulama | "Kaç ülkede mekanım var?" |
| `compare_places` | Mekan karşılaştırma | "Bu iki restoranı karşılaştır" |
| `export_data` | Veri export | "İstanbul mekanlarımı CSV olarak ver" |

**Agent Loop Akışı:**
```
User: "Bu hafta sonu için İstanbul Avrupa yakasında 4+ puanlı 
       3 restoran öner ve favorilere ekle"

Agent:
  Step 1: search_places({city: "Istanbul", category: "Restaurant", 
          rating_min: 4, sort: "google_rating_desc"})
  Step 2: Filter results → Avrupa yakası (koordinat kontrolü)
  Step 3: Top 3 seç → kullanıcıya göster + açıklama
  Step 4: Onay alınca → update_place({visit_status: "favorite"}) × 3
  Step 5: Özet: "3 mekanı favorilerinize ekledim: ..."
```

**UI:**
- Floating chat butonu (sağ alt köşe) → slide-up panel
- Veya `/assistant` tam sayfa görünüm
- Streaming response (Vercel AI SDK `useChat`)
- Tool execution göstergesi: "🔍 Mekanlar aranıyor..." → "✅ 3 sonuç bulundu"
- Inline place card'lar (chat içinde tıklanabilir mekan kartları)
- Action confirmation: "Bu 3 mekanı favorilere ekleyeyim mi?" → [Evet] [Hayır]

**Model:** Haiku 4.5 (basit sorgular) / Sonnet 4.6 (karmaşık reasoning + multi-tool)
**Maliyet:** Haiku: ~$0.002/tur, Sonnet: ~$0.015/tur
**Effort:** Yüksek (8-12 gün) — Agent loop + tool definitions + streaming UI + action confirmation.
**Impact:** 🔥🔥🔥 — "Killer feature". Kişisel mekan asistanı = güçlü diferansiyasyon.

---

### AI-03: Akıllı Kategorizasyon 🔄 v2'den devir

**v2 Referans:** AI-03 — spec aynen geçerli.
**Model:** Haiku 4.5 | **Maliyet:** ~$0.001/mekan
**Effort:** 1-2 gün | **Impact:** 🔥🔥

---

### AI-04: Otomatik Etiket Önerisi 🔄 v2'den devir

**v2 Referans:** AI-04 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** DataForSEO `place_topics` + `attributes` verisini LLM'ye context olarak ver → daha doğru tag'ler
- **Yeni:** Batch tagging: import sonrası tüm yeni mekanlara toplu tag önerisi → tek ekranda onay

**Model:** Haiku 4.5 | **Maliyet:** ~$0.001/mekan
**Effort:** 1-2 gün | **Impact:** 🔥🔥

---

## Group J: Content Generation & Analysis

### AI-05: Mekan Özeti & Review Sentezi 🔄 v2'den devir

**v2 Referans:** AI-05 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** DataForSEO reviews (depth:50 ile 50'ye kadar review) çok daha zengin context sağlıyor
- **Yeni:** Çok dilli özet: kullanıcının diline göre (Türkçe/İngilizce) özet üretimi
- **Yeni:** "Highlight" snippets: özetten 3 key phrase çıkar → pill olarak göster

**Model:** Haiku 4.5 | **Maliyet:** ~$0.002/mekan
**Effort:** 2-3 gün | **Impact:** 🔥🔥🔥

---

### AI-06: Review Sentiment Analizi 🔄 v2'den devir

**v2 Referans:** AI-06 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** DataForSEO `rating_distribution` (1-5 yıldız dağılımı) zaten mevcut → sentiment ile birleştir
- **Yeni:** Trend analizi: "Son 3 ay servis şikayetleri artıyor" (review date bazlı)
- **Yeni:** Karşılaştırmalı sentiment: F-04 (karşılaştırma) ile entegre → hangi mekan serviste daha iyi?

**Model:** Haiku 4.5 | **Maliyet:** ~$0.003/mekan
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### AI-11: AI Mekan Açıklama Üretici 🆕 Yeni

**Ne:** Manuel eklenen veya veri eksik mekanlar için AI ile zengin açıklama üretme.

**Neden:**
- F-01 (manuel ekleme) ile eklenen mekanlar minimal veriyle gelir: isim + koordinat
- Google/DataForSEO verisi olmayan mekanlar (kişisel yerler, gizli noktalar) için açıklama eksik
- LLM web bilgisiyle mekan hakkında bilgi üretebilir (ünlü mekanlar için)
- Kullanıcının notlarından structured açıklama üretme

**Teknik Uygulama:**
```
Input: name + location + user_notes + category
  → Claude Haiku/Sonnet
  → Output: {
      description: "...",      // 2-3 cümle tanıtım
      tips: ["...", "..."],    // ziyaret ipuçları
      best_time: "morning",    // en iyi zaman
      estimated_duration: 60,  // dakika
      nearby_highlights: ["..."] // çevredeki dikkat çekici yerler
    }
  → Cache: google_data.ai_description
```

**Model:** Haiku 4.5 (bilinen mekanlar) / Sonnet 4.6 (belirsiz mekanlar)
**Maliyet:** ~$0.002/mekan
**Effort:** 2-3 gün | **Impact:** 🔥🔥

---

### AI-12: AI Seyahat Günlüğü Oluşturucu 🆕 Yeni

**Ne:** Trip verilerinden (mekanlar, günler, rotalar, fotoğraflar, notlar) otomatik blog/günlük metni üretme.

**Neden:**
- Kullanıcılar seyahat deneyimlerini paylaşmak istiyor ama yazmak zahmetli
- Trip + journal notları + fotoğraflar → AI ile akıcı bir metin
- Public sharing (F-11a) ile paylaşılan trip journal = viral content
- F-22 (Travel Journal) ile doğal entegrasyon

**Teknik Uygulama:**
```
Input: trip_data (days, places, notes, photos)
  → Claude Sonnet → streaming blog metni
  → Markdown output → editable (kullanıcı düzenleyebilir)
  → "Publish" → /shared/[slug] public URL
  → "Export" → Medium/Substack formatında

Journal Prompt:
"Bu seyahat verilerinden eğlenceli, kişisel bir blog yazısı yaz.
Kullanıcının notlarını entegre et, mekan deneyimlerini zenginleştir.
Stil: samimi, birinci şahıs, emoji minimal, Türkçe."
```

**Model:** Sonnet 4.6 (kaliteli uzun metin üretimi)
**Maliyet:** ~$0.03/journal
**Effort:** 3-5 gün | **Impact:** 🔥🔥🔥

---

## Group K: Discovery & Recommendation

### AI-07: Kişiselleştirilmiş Mekan Önerileri (Multi-Signal) 🔄 v2'den devir (genişletildi)

**v2 Referans:** AI-07 — spec genişletildi.

**v3 Farkları:**
- v2: Tek profil vektörü → v3: **Multi-signal scoring** (kategori, rating, lokasyon, zaman, sosyal, DataForSEO topics)
- v2: Google Nearby Search → v3: **DataForSEO people_also_search** + Google birlikte
- v2: Sadece mekan önerisi → v3: **Contextualized öneriler** (zaman, hava durumu, mood)

**Multi-Signal Profil:**
```json
{
  "category_affinity": {"Restaurant": 0.85, "Cafe": 0.72, "Bar": 0.45},
  "cuisine_preference": {"Japanese": 0.9, "Italian": 0.8, "Turkish": 0.7},
  "price_range": {"mid": 0.7, "high": 0.2, "low": 0.1},
  "time_pattern": {"morning_cafe": 0.8, "evening_restaurant": 0.9},
  "location_clusters": [{"center": [28.97, 41.02], "radius_km": 3, "name": "Karaköy-Beyoğlu"}],
  "social_signal": {"similar_users_like": ["place_id_1", "place_id_2"]},
  "topic_affinity": {"rooftop": 0.8, "live_music": 0.6, "pet_friendly": 0.4}
}
```

**Öneri Trigger'ları:**
- Günlük: "Bugün için öneriler" (saat + konum bazlı)
- Haftalık: email digest → "Bu hafta keşfet"
- Olay bazlı: yeni şehir ziyareti → "Bu şehirde bunları dene"
- Mood bazlı: AI-13 ile entegre → "Macera arıyorum" → outdoor/hiking mekanlar

**Model:** Haiku 4.5 (profil çıkarma) + Sonnet 4.6 (contextualized açıklama)
**Maliyet:** ~$0.005/öneri seti
**Effort:** Seviye 1 (Rule+LLM): 4-5 gün, Seviye 2 (Embedding): 8-10 gün | **Impact:** 🔥🔥🔥

---

### AI-08: Akıllı Import 🔄 v2'den devir

**v2 Referans:** AI-08 — spec aynen geçerli.
**Model:** Haiku 4.5 | **Maliyet:** ~$0.002/başarısız mekan
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### AI-13: Mood-Based Discovery (Ruh Haline Göre Keşif) 🆕 Yeni

**Ne:** "Huzurlu bir yer istiyorum", "Macera arıyorum", "Romantik akşam" → ruh haline uygun mekan önerileri.

**Neden:**
- Filtreler (kategori, şehir, rating) "ne" arıyorsun sorusuna cevap veriyor
- "Nasıl hissediyorsun?" sorusu daha doğal ve keşif odaklı
- Mood → atmosfer eşleştirmesi: DataForSEO `attributes` + `place_topics` ile mümkün
- Spotify'ın "mood playlist"i gibi → "mood-based place playlist"

**Mood Kategorileri:**

| Mood | Eşleşen Mekan Özellikleri | Örnek Output |
|------|---------------------------|--------------|
| 🧘 Huzurlu | quiet, garden, sea view, park, spa | Deniz kenarı cafe, botanik bahçe |
| 🎉 Eğlenceli | live music, rooftop, nightlife, club | Rooftop bar, canlı müzik mekanı |
| 💑 Romantik | candlelight, fine dining, view, intimate | Teras restoran, butik otel |
| 🏔️ Macera | outdoor, hiking, extreme, nature | Doğa parkuru, dalış noktası |
| 📚 Sakin/Çalışma | quiet, wifi, cozy, library | Sessiz cafe, co-working |
| 👨‍👩‍👧 Aile | family-friendly, playground, kid-friendly | Aile restoranı, park |
| 💰 Bütçe | cheap, value, street food | Sokak lezzetleri, budget otel |

**Teknik:**
```
User mood seçimi (UI: emoji + label grid)
  → Claude prompt: "Kullanıcının {count} mekanı içinden {mood}a uygun olanları seç"
  → Context: mekan topics + attributes + rating + reviews özeti
  → Output: sıralı liste + her mekan için "neden uygun" açıklaması
```

**UI:**
- `/discover` sayfasında mood grid (7 mood kartı, emoji + label)
- Veya AI-02 (asistan) ile sohbet: "Nasıl bir akşam istiyorsun?"
- Sonuç: mood-themed mekan kartları (özel renk/ikon)

**Model:** Haiku 4.5
**Maliyet:** ~$0.003/mood sorgu
**Effort:** 3-4 gün | **Impact:** 🔥🔥🔥

---

### AI-14: Yemek & Diyet Uyumu Eşleştirme 🆕 Yeni

**Ne:** Kullanıcının diyet tercihleri/kısıtlamaları (vegan, gluten-free, halal, keto) ile restoran eşleştirme.

**Neden:**
- Diyet kısıtlaması olan kullanıcılar her yeni şehirde "Vegan nerede yenir?" sorusuyla karşılaşır
- Google reviews'da diyet bilgisi var ama unstructured
- LLM ile reviews'dan diyet uyumu çıkarma mümkün
- Profil bazlı: bir kez belirt, her zaman filtrele

**Teknik:**
```
User profile → dietary_preferences: ["vegan", "gluten_free"]

Her mekan için:
  reviews + menu bilgisi (varsa) + place_topics
    → Claude Haiku
    → dietary_compatibility: {
        "vegan": { score: 0.8, note: "Geniş vegan menü var" },
        "gluten_free": { score: 0.3, note: "Sınırlı seçenek" }
      }
    → Cache: google_data.ai_dietary
```

**Model:** Haiku 4.5
**Maliyet:** ~$0.002/mekan
**Effort:** 2-3 gün | **Impact:** 🔥🔥

---

### AI-15: AI Mekan Karşılaştırma Analizi 🆕 Yeni

**Ne:** F-04 (side-by-side karşılaştırma) üzerine AI ile derinlemesine artı/eksi analizi.

**Neden:**
- Sayısal karşılaştırma (rating, fiyat) tek başına yetersiz
- "Bu iki restorandan hangisi daha iyi?" sorusuna numaralı cevap değil, nüanslı analiz
- Reviews'dan çıkarılan tema bazlı karşılaştırma çok değerli
- Karar verme sürecini dramatik hızlandırır

**Teknik:**
```
place_A + place_B (full data: reviews, rating, topics, attributes)
  → Claude Sonnet
  → Output: {
      recommendation: "place_A",
      confidence: 0.75,
      comparison: {
        "Yemek Kalitesi": { winner: "A", detail: "A daha taze malzeme..." },
        "Servis": { winner: "B", detail: "B daha hızlı ve güler yüzlü..." },
        "Atmosfer": { winner: "A", detail: "A'nın terası manzaralı..." },
        "Fiyat/Performans": { winner: "B", detail: "B daha uygun fiyatlı..." }
      },
      summary: "Özel bir akşam için A, günlük yemek için B daha iyi seçim."
    }
```

**Model:** Sonnet 4.6
**Maliyet:** ~$0.01/karşılaştırma
**Effort:** 2-3 gün | **Impact:** 🔥🔥

---

## Group L: AI-Powered Planning

### AI-09: AI Seyahat Planlama Asistanı (Multi-Modal) 🔄 v2'den devir (genişletildi)

**v2 Referans:** AI-09 — spec genişletildi.

**v3 Farkları:**
- v2: Mekan dağıtma → v3: **Multi-modal input** (metin + fotoğraf + URL)
- v2: Tek şehir → v3: **Multi-şehir trip** (İstanbul → Kapadokya → Antalya)
- v2: Statik plan → v3: **Iterative refinement** ("2. günü değiştir", "daha ucuz alternatif")
- v2: Sadece kayıtlı mekanlar → v3: **Hybrid** (kayıtlı + yeni öneriler)

**Multi-Modal Input Örnekleri:**
```
Text: "3 günlük İstanbul, bütçe dostu, yemek odaklı"
Photo: Instagram screenshot → mekan tespit → plana ekle
URL: Blog linki → mekan listesi çıkar → plana entegre
Voice: "Yarın sabah kahvaltı, öğlen müze, akşam balık yemek istiyorum"
```

**Iterative Refinement:**
```
User: "3 günlük İstanbul planı yap"
AI: [Plan oluşturur → gösterir]
User: "2. gün çok yorucu, azalt"
AI: [2. günden 1 mekan çıkar, 3. güne taşır]
User: "Akşamları daha ucuz alternatifler öner"
AI: [Akşam restoranlarını bütçe-dostu seçeneklerle değiştirir]
```

**Model:** Sonnet 4.6 (complex reasoning + multi-step)
**Maliyet:** ~$0.03-0.08/plan (iterative refinement dahil)
**Effort:** 8-12 gün | **Impact:** 🔥🔥🔥

---

### AI-10: Görsel Mekan Tanıma (Vision) 🔄 v2'den devir

**v2 Referans:** AI-10 — spec aynen geçerli.

**v3 Güncellemesi:**
- **Yeni:** Çoklu fotoğraf: 1-3 fotoğraf yükle → birleşik analiz (tabela + menü + iç mekan)
- **Yeni:** Menü OCR: menü fotoğrafı → yemek listesi + fiyatlar (structured)
- **Yeni:** AI-23 (Food Recognition) ile entegre: yemek fotoğrafı → restoran tespit

**Model:** Sonnet 4.6 (vision)
**Maliyet:** ~$0.01/görsel
**Effort:** 3-5 gün | **Impact:** 🔥🔥

---

### AI-16: AI Rota Optimizasyonu (Real-Time) 🆕 Yeni

**Ne:** Trip sırasında gerçek zamanlı rota optimizasyonu: trafik, hava durumu, çalışma saatleri, gecikmeler.

**Neden:**
- Mevcut trip planner statik (oluşturulduğu andaki durumu yansıtır)
- "Müze bugün kapalı" → alternatif önerisi
- "Yağmur yağıyor" → outdoor plan → indoor'a çevir
- "Trafik var" → rota yeniden hesapla

**Teknik:**
```
Mevcut trip plan + gerçek zamanlı veriler:
  - Opening hours (DataForSEO, cached)
  - Hava durumu (OpenWeatherMap API)
  - Mevcut konum (Geolocation API)
  - Geçen süre vs. planlanan süre

  → Claude Sonnet + tool calling
  → Output: güncellenmiş plan + değişiklik açıklaması
  → "Müze kapalı, yerine Galata Kulesi'ni öneriyorum (500m uzaklıkta)"
```

**Model:** Sonnet 4.6
**Maliyet:** ~$0.01/re-plan
**Effort:** 5-7 gün | **Impact:** 🔥🔥🔥

---

### AI-17: AI Bütçe Planlayıcı & Tahminci 🆕 Yeni

**Ne:** Trip bütçe tahmini: konaklama, yemek, ulaşım, etkinlik maliyetlerini AI ile hesaplama.

**Neden:**
- "Bu trip ne kadar tutar?" en sık sorulan soru
- DataForSEO `price_level` + reviews'daki fiyat bilgileri → maliyet tahmini
- Kategori bazlı ortalama harcama (cafe: ~$5, restaurant: ~$25, museum: ~$15)
- Şehir bazlı fiyat düzeyi (İstanbul vs. Tokyo vs. Paris)

**Teknik:**
```
Trip data (days, places, city)
  → Claude Haiku
  → Context: price_level, city cost index, category averages
  → Output: {
      total_estimated: { min: 450, max: 750, currency: "USD" },
      daily_breakdown: [
        { day: 1, food: 60, transport: 15, activities: 30, accommodation: 80 }
      ],
      savings_tips: ["Metro kart alın", "Müze kart ile %40 tasarruf"]
    }
```

**Model:** Haiku 4.5
**Maliyet:** ~$0.003/tahmin
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### AI-18: AI Grup Trip Koordinatörü 🆕 Yeni

**Ne:** Birden fazla kullanıcının tercihlerini birleştirerek ortak plan oluşturma.

**Neden:**
- F-11 (Collaborative Trips) ile grup seyahati planlama mümkün oluyor
- "3 kişinin tercihleri farklı — herkesi mutlu eden plan?" problemi
- AI ile tercih birleştirme: Ahmet sushi, Mehmet pizza, Ayşe vegan → hepsi için uygun yer

**Teknik:**
```
User profiles: [user_A_preferences, user_B_preferences, user_C_preferences]
  → Claude Sonnet
  → Constraint satisfaction:
    - Herkesin en az 1 favori kategorisi günde olsun
    - Diyet kısıtlamalarını karşıla
    - Herkese uygun fiyat aralığı
  → Output: optimized group plan + "consensus score" per place
```

**Model:** Sonnet 4.6
**Maliyet:** ~$0.02/grup plan
**Effort:** 4-6 gün | **Impact:** 🔥🔥

---

## Group M: Visual Intelligence & Media

### AI-19: AI Fotoğraf Galerisi Küratörü 🆕 Yeni

**Ne:** Mekan fotoğraflarından en kaliteli + çeşitli olanları seç, duplikatları filtrele, kapak fotoğrafı belirle.

**Neden:**
- DataForSEO/Google'dan gelen fotoğraflar bazen düşük kalite veya duplicate
- Kullanıcı fotoğrafları da eklenince (F-13) galeri karışabilir
- AI ile: "Bu 10 fotoğraftan en iyi 4'ünü seç + kapak olarak dış mekan fotoğrafını kullan"

**Teknik:**
```
Fotoğraf listesi (URL/storage paths)
  → Claude Vision (batch)
  → Her fotoğrafı skorla: quality (blur, light, composition), content type (food, interior, exterior, menu), uniqueness
  → Output: { cover: "photo_3", selected: ["photo_3", "photo_1", "photo_7", "photo_5"], duplicates: ["photo_2", "photo_6"] }
```

**Model:** Haiku 4.5 (vision, hız öncelikli)
**Maliyet:** ~$0.005/galeri
**Effort:** 2-3 gün | **Impact:** 🔥

---

### AI-20: AI Sosyal Paylaşım İçerik Üretici 🆕 Yeni

**Ne:** Mekan veya trip için Instagram/Twitter/TikTok paylaşım metni + hashtag üretme.

**Neden:**
- Kullanıcılar mekan deneyimlerini sosyal medyada paylaşmak istiyor
- "Ne yazayım?" → AI ile caption + hashtag + emoji → tek tıkla kopyala
- Viral loop: paylaşılan içerik → yeni kullanıcı çekme

**Teknik:**
```
Place data + user notes + photos
  → Claude Haiku
  → Output: {
      instagram: "Karaköy'ün gizli cenneti 🌊 Taze balık + muhteşem manzara...\n\n#istanbul #karakoy #seafood #istanbuleats",
      twitter: "Bu mekanı keşfetmek için @MapOrganiser kullanın 📍 Karaköy'de 4.7 puanlı gizli balıkçı",
      tiktok: "POV: Karaköy'de yıllardır gizli kalmış balıkçıyı keşfettin 🐟"
    }
```

**Model:** Haiku 4.5
**Maliyet:** ~$0.001/içerik
**Effort:** 1-2 gün | **Impact:** 🔥🔥

---

### AI-21: AI Menü / Yemek Tanıma 🆕 Yeni

**Ne:** Yemek fotoğrafından dish tanıma + hangi restorandan olabileceğini tahmin.

**Neden:**
- "Bu yemeği nerede yemiştim?" → fotoğraftan mekan bulma
- Menü fotoğrafı → structured menü listesi (dish adları + fiyatlar)
- AI-10 (vision) ile entegre ama food-specific

**Teknik:**
```
Food photo → Claude Vision
  → Output: {
      dishes: [
        { name: "Eggs Benedict", cuisine: "American Brunch", estimated_price: "$15-20" },
        { name: "Avocado Toast", cuisine: "Modern Cafe", estimated_price: "$12-16" }
      ],
      restaurant_type: "Brunch Cafe",
      ambiance: "modern, minimalist, natural lighting"
    }
```

**Model:** Sonnet 4.6 (vision)
**Maliyet:** ~$0.01/fotoğraf
**Effort:** 2-3 gün | **Impact:** 🔥

---

## Group N: AI Agents & Automation

### AI-22: AI Veri Kalite Ajanı (Background Agent) 🆕 Yeni

**Ne:** Arka planda sürekli çalışan AI agent: eksik verileri tamamla, tutarsızlıkları düzelt, stale bilgileri güncelle.

**Neden:**
- Mekan verileri zamanla eski kalır (kapanan mekanlar, değişen saatler)
- Import ile gelen veriler eksik olabilir (eksik kategori, eksik tag, eksik adres)
- Kullanıcının tek tek düzeltme yapması verimsiz
- Background agent ile "veri hijyeni" otomatik sağlanır

**Ajan Görevleri:**

| Görev | Tetikleyici | Aksiyon |
|-------|------------|--------|
| **Eksik kategori** | category_id = "Other" | LLM ile kategorize (AI-03) |
| **Eksik etiket** | tag count = 0 | LLM ile tag öner (AI-04) → otomatik ata |
| **Eksik özet** | ai_summary = null + reviews var | AI-05 ile özet üret |
| **Stale veri** | updated_at > 90 gün + rating var | DataForSEO re-enrich |
| **Kapanmış mekan** | DataForSEO `permanently_closed: true` | Kullanıcıya bildirim |
| **Eksik fotoğraf** | photo count = 0 | DataForSEO/Google'dan fotoğraf çek |
| **Tutarsız konum** | city vs. koordinat uyuşmazlığı | Reverse geocoding ile düzelt |

**Çalışma Modu:**
- Vercel Cron Job: günlük 1 kez çalışır (gece)
- Kullanıcı bazlı: en eski güncellenen mekanlardan başla
- Batch: 50 mekan/run, LLM call'ları batch olarak
- Rate limit: aylık max 500 ajan aksiyonu/kullanıcı (free), sınırsız (pro)

**Model:** Haiku 4.5 (batch efficiency)
**Maliyet:** ~$0.05/kullanıcı/ay (50 mekan/gün × 30 gün)
**Effort:** 5-7 gün | **Impact:** 🔥🔥🔥

---

### AI-23: AI Asistan Bellek Sistemi 🆕 Yeni

**Ne:** AI-02 (Agentic Asistan) için kalıcı bellek: kullanıcı tercihlerini, geçmiş sohbetleri, favori mekanları hatırlama.

**Neden:**
- v2 AI-02: "Son 10 mesaj context" → her sohbet sıfırdan başlıyor
- "Geçen sefer önerdiğin o Japon restoranı neydi?" → cevap veremez
- Kalıcı bellek ile AI asistan gerçek bir "kişisel asistan" oluyor
- Kullanıcının tekrarlayan tercihlerini öğrenmesi → daha iyi öneriler

**Teknik Uygulama:**

```sql
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text, -- AI tarafından üretilen başlık
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES ai_conversations ON DELETE CASCADE,
  role text NOT NULL, -- 'user' | 'assistant' | 'tool'
  content text NOT NULL,
  tool_calls jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE ai_user_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  memory_type text NOT NULL, -- 'preference' | 'fact' | 'feedback'
  content text NOT NULL,
  source_conversation_id uuid REFERENCES ai_conversations,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz -- bazı bilgiler geçici
);
```

**Bellek Tipleri:**

| Tip | Örnek | Otomatik Kayıt |
|-----|-------|----------------|
| **Tercih** | "Japon mutfağını seviyor" | Favori + yüksek rating mekanlardan çıkarım |
| **Gerçek** | "İstanbul'da yaşıyor" | Konum verisi + mekan dağılımından |
| **Geri bildirim** | "Daha az formal mekan önerisi" | Kullanıcının red/kabul pattern'lerinden |
| **Geçici** | "Bu hafta sonu planı yapıyor" | Sohbet context'inden, 7 gün TTL |

**Model:** Haiku 4.5 (memory extraction) + Sonnet 4.6 (conversation with memory)
**Maliyet:** ~$0.001/memory operation
**Effort:** 5-7 gün | **Impact:** 🔥🔥🔥

---

### AI-24: AI Otomatik Mekan Keşif Ajanı 🆕 Yeni

**Ne:** Kullanıcının profili ve boşluklarına göre otomatik mekan keşfeden ve öneren ajan.

**Neden:**
- Kullanıcının henüz keşfetmediği ama beğeneceği mekanları proaktif bulma
- "İstanbul'da 50 restoran var ama hiç sushi restoranı yok" → sushi önerisi
- "Kadıköy'de hiç mekan yok ama oraya sık gidiyor" → Kadıköy önerileri
- Haftalık email digest: "Bu hafta sizin için 5 yeni keşif"

**Teknik:**
```
Profil analizi:
  1. Kategori boşlukları: restaurant 50, cafe 30, museum 2 → müze öner
  2. Coğrafi boşluklar: Beyoğlu 40, Kadıköy 0 → Kadıköy öner
  3. Rating pattern: 4.5+ mekanları tercih → sadece yüksek rated öner
  4. Trending: DataForSEO people_also_search + yeni açılan mekanlar

  → Claude Sonnet + DataForSEO search
  → Haftalık 5 kişiselleştirilmiş öneri
  → In-app notification + email digest
```

**Model:** Sonnet 4.6 (profil analizi + arama)
**Maliyet:** ~$0.01/hafta/kullanıcı
**Effort:** 5-7 gün | **Impact:** 🔥🔥🔥

---

### AI-25: AI Dil Asistanı (Seyahat İçin) 🆕 Yeni

**Ne:** Seyahatte dil bariyerini aşmak için: menü çevirisi, temel cümleler, yerel dilde iletişim yardımı.

**Neden:**
- Yurtdışı seyahatlerde dil bariyeri en büyük sorun
- Menü çevirisi (AI-21 + çeviri): Japonca menü fotoğrafı → Türkçe çeviri
- Trip'in hedef ülkesine göre "cheat sheet": "Restoranda bu 10 cümle yeter"
- AI-02 (asistan) ile entegre: "Bu menüyü çevir" → asistan çevirir

**Teknik:**
```
Trip destination country → language detection
  → Claude Sonnet
  → Output: {
      essential_phrases: [
        { local: "Hesap lütfen", translation: "Check, please", pronunciation: "che-ku pu-li-zu" },
        ...
      ],
      menu_translation: { /* menü fotoğrafından */ },
      cultural_tips: ["Japonya'da bahşiş verilmez", ...]
    }
```

**Model:** Sonnet 4.6 (multi-language)
**Maliyet:** ~$0.005/dil seti
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

## Group O: Social & Personalization AI

### AI-26: AI Trend Analizi & Insight 🆕 Yeni

**Ne:** Kullanıcının mekan alışkanlıklarındaki trendleri tespit ve raporlama.

**Neden:**
- "Son 3 ayda %40 daha fazla cafe ekliyorum" → insight
- "İstanbul dışına çıkmam azaldı" → motivasyon
- "Rating ortalamanız 4.2'den 4.5'e çıktı" → farkındalık
- Gamification: "Bu ay en aktif ayınız!" → retention

**Teknik:**
```
Son 90 gün verisi → Claude Haiku
  → Output: {
      trends: [
        { type: "category_shift", detail: "Cafe ekleme %40 arttı", period: "son 3 ay" },
        { type: "geographic_expansion", detail: "2 yeni ülke: Japonya, Güney Kore" },
        { type: "rating_improvement", detail: "Ortalama seçim kalitesi artıyor (4.2→4.5)" }
      ],
      milestones: [
        { type: "achievement", detail: "300. mekanınız! 🎉" },
        { type: "streak", detail: "4 hafta üst üste yeni mekan" }
      ],
      recommendations: [
        "Bu trende göre yakında bir Japonya tripi planlamak ister misiniz?"
      ]
    }
```

**Model:** Haiku 4.5
**Maliyet:** ~$0.003/rapor
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

### AI-27: AI Harita Notları & Bölge Özeti 🆕 Yeni

**Ne:** Harita üzerinde bölge bazlı AI özeti: "Karaköy: 8 mekanınız var. Öne çıkan: cafeler. Ortalama rating: 4.4"

**Neden:**
- Çok mekan olan kullanıcılar haritada "büyük resmi" göremez
- Zoom level'a göre bölge özetleri → anında context
- "Bu semtte ne kadar aktifim?" sorusuna görsel cevap
- AI-09 (trip planning) ile entegre: bölge özetini plan context'ine ekle

**Teknik:**
```
Viewport bounds → bu bölgedeki mekanlar
  → Claude Haiku
  → Output: {
      summary: "Beyoğlu: 12 mekan, çoğunluğu bar & restoran. Favoriniz: Mikla.",
      stats: { count: 12, top_category: "Bar", avg_rating: 4.3 },
      suggestion: "Bu bölgede hiç cafe eklememişsiniz. Kronotrop'u deneyin."
    }
  → UI: Harita üzerinde floating card (zoom level'a göre göster/gizle)
```

**Model:** Haiku 4.5
**Maliyet:** ~$0.001/bölge özeti
**Effort:** 3-4 gün | **Impact:** 🔥🔥

---

## Group P: AI Infrastructure & Platform

### AI-28: AI Gateway & Model Routing 🆕 Yeni (Altyapı)

**Ne:** Tüm AI feature'lar için merkezi model yönetimi: provider failover, cost tracking, rate limiting, A/B testing.

**Neden:**
- 27 AI feature farklı modeller kullanıyor (Haiku, Sonnet, Opus)
- Provider downtime → failover gerekli (Claude → OpenAI → Google)
- Kullanıcı bazlı maliyet takibi → subscription tier kontrolü
- A/B testing: Haiku vs. Sonnet kalite karşılaştırma

**Teknik:**
- **Vercel AI Gateway** kullanılır (native entegrasyon)
- Model routing config:
  ```typescript
  const modelConfig = {
    'quick-query': { primary: 'anthropic/claude-haiku-4.5', fallback: 'openai/gpt-5.4' },
    'complex-reasoning': { primary: 'anthropic/claude-sonnet-4.6', fallback: 'openai/gpt-5.4' },
    'vision': { primary: 'anthropic/claude-sonnet-4.6', fallback: 'openai/gpt-5.4' },
    'agentic': { primary: 'anthropic/claude-sonnet-4.6', fallback: 'anthropic/claude-opus-4.6' },
  };
  ```
- Mevcut `api_usage` tablosu genişletilir: `sku` → AI model isimleri
- Dashboard: Settings > AI Usage → model bazlı harcama, istek sayısı

**Effort:** 3-5 gün | **Impact:** Altyapısal (tüm AI feature'lar bunun üzerine)

---

# PART 4 — PRIORITY MATRIX & ROADMAP

## v3 Impact vs Effort Matrix

```
                           IMPACT
              Low          Medium         High
         ┌────────────┬────────────┬────────────┐
  Low    │ AI-19      │ AI-03      │ AI-01      │
  Effort │ AI-20      │ AI-04      │ AI-05      │
  (1-3d) │ AI-21      │ AI-11      │            │
         │            │ AI-14      │            │
         ├────────────┼────────────┼────────────┤
  Med    │ F-14       │ F-03       │ F-21       │
  Effort │ AI-26      │ F-04       │ F-09       │
  (3-7d) │ AI-27      │ F-08       │ F-06       │
         │            │ AI-06      │ AI-02      │
         │            │ AI-08      │ AI-13      │
         │            │ AI-10      │ AI-22      │
         │            │ AI-15      │ AI-23      │
         │            │ AI-17      │ AI-24      │
         │            │ AI-25      │ AI-28      │
         │            │ AI-18      │ F-01       │
         │            │ F-18       │            │
         ├────────────┼────────────┼────────────┤
  High   │ F-16       │ F-13       │ F-11       │
  Effort │            │ F-15       │ F-17       │
  (8+d)  │            │ F-22       │ F-19       │
         │            │ F-18       │ F-20       │
         │            │            │ F-07       │
         │            │            │ F-24       │
         │            │            │ AI-07      │
         │            │            │ AI-09      │
         │            │            │ AI-16      │
         │            │            │ F-23       │
         │            │            │ F-25       │
         └────────────┴────────────┴────────────┘
```

## Önerilen Roadmap (v3)

### Phase 1 — AI Foundation + Quick Wins (1-2 hafta)

| ID | Feature | Effort | Tip | Gerekçe |
|----|---------|--------|-----|---------|
| AI-28 | AI Gateway & Model Routing | 3-5d | 🆕 | Tüm AI'ların altyapısı |
| AI-01 | Doğal Dil Filtreleme | 2-3d | 🔄 | En yüksek wow/effort oranı |
| AI-05 | Review Özeti | 2-3d | 🔄 | editorialSummary yerine |
| AI-03 | Akıllı Kategorilendirme | 1-2d | 🔄 | Veri kalitesi iyileştirme |
| AI-04 | Etiket Önerisi | 1-2d | 🔄 | Organizasyon iyileştirme |
| F-06 | Export & Backup | 2-4d | 🔄 | Veri güveni, GDPR |

**Phase 1 çıktısı:** AI altyapısı hazır + 4 AI feature canlı + export.

### Phase 2 — Intelligence Layer (2-4 hafta)

| ID | Feature | Effort | Tip | Gerekçe |
|----|---------|--------|-----|---------|
| AI-02 | Agentic Mekan Asistanı | 8-12d | 🔄→🆕 | Killer feature, diferansiyasyon |
| AI-23 | AI Bellek Sistemi | 5-7d | 🆕 | AI-02 üzerine kişiselleştirme |
| AI-22 | Veri Kalite Ajanı | 5-7d | 🆕 | Background veri iyileştirme |
| F-21 | Gelişmiş Place Detail | 4-6d | 🆕 | Mevcut veriyi değerlendir |
| F-01 | Manuel Mekan Ekleme | 3-5d | 🔄 | Google bağımlılığını azalt |

**Phase 2 çıktısı:** Agentic asistan canlı + zenginleştirilmiş mekan sayfaları.

### Phase 3 — Discovery & Planning (3-5 hafta)

| ID | Feature | Effort | Tip | Gerekçe |
|----|---------|--------|-----|---------|
| AI-07 | Multi-Signal Recommendations | 4-5d | 🔄→🆕 | Discovery katmanı |
| AI-09 | Multi-Modal Trip Planner | 8-12d | 🔄→🆕 | Premium feature |
| AI-13 | Mood-Based Discovery | 3-4d | 🆕 | Keşif deneyimi |
| AI-06 | Sentiment Analizi | 3-4d | 🔄 | Review zenginleştirme |
| AI-12 | Seyahat Günlüğü Oluşturucu | 3-5d | 🆕 | Content generation |
| F-09 | Harita Heatmap | 3-5d | 🆕 | Görselleştirme + gamification |

**Phase 3 çıktısı:** Discovery + AI trip planning canlı.

### Phase 4 — Social & Premium (4-8 hafta)

| ID | Feature | Effort | Tip | Gerekçe |
|----|---------|--------|-----|---------|
| F-11 | Collaborative Lists & Trips | 8-12d | 🔄→🆕 | Sosyal katman |
| F-17 | Sosyal Keşif & Feed | 10-15d | 🆕 | Viral büyüme |
| F-25 | Premium Subscription | 8-12d | 🆕 | Gelir modeli |
| AI-24 | Otomatik Keşif Ajanı | 5-7d | 🆕 | Proaktif öneriler |
| F-19 | Gelişmiş İstatistik | 6-9d | 🆕 | Gamification derinleştirme |

**Phase 4 çıktısı:** Sosyal katman + monetization canlı.

### Phase 5 — Platform Expansion (6-12 hafta)

| ID | Feature | Effort | Tip | Gerekçe |
|----|---------|--------|-----|---------|
| F-20 | Offline Modu | 8-12d | 🆕 | Seyahat UX |
| F-07 | Web Clipper Extension | 5-8d | 🆕 | Growth channel |
| F-23 | Native Mobile App | 30-60d | 🆕 | Platform genişleme |
| F-24 | Template Marketplace | 6-10d | 🆕 | Community content |
| AI-16 | Real-Time Rota Optimizasyonu | 5-7d | 🆕 | Dynamic planning |

### Backlog

| ID | Feature | Not |
|----|---------|-----|
| F-03 | Kayıtlı Filtreler | Power user |
| F-04 | Mekan Karşılaştırma | Nice-to-have |
| F-05 | Quick Add (Voice) | Native app ile |
| F-08 | Nearby + Proximity | Proximity native ile |
| F-10 | Gelişmiş Harita Etkileşimleri | Power user |
| F-12 | Duplikat Tespiti | Maintenance |
| F-13 | Rich Notes & Media | Editor + upload |
| F-14 | Aktivite Logu | Stats ile birleştirilebilir |
| F-15 | Bildirimler | Push altyapısı |
| F-16 | i18n | Uluslararası büyüme |
| F-18 | Calendar Entegrasyonu | Trip + takvim |
| F-22 | Seyahat Günlüğü | Content platform |
| AI-08 | Akıllı Import | Import pipeline |
| AI-10 | Görsel Tanıma | Vision |
| AI-11 | Mekan Açıklama Üretici | Manuel mekanlar |
| AI-14 | Diyet Uyumu | Niche |
| AI-15 | Karşılaştırma Analizi | F-04 ile |
| AI-17 | Bütçe Planlayıcı | Trip + finans |
| AI-18 | Grup Trip Koordinatörü | F-11 ile |
| AI-19 | Fotoğraf Küratörü | F-13 ile |
| AI-20 | Sosyal İçerik Üretici | F-17 ile |
| AI-21 | Menü / Yemek Tanıma | Vision niche |
| AI-25 | Dil Asistanı | Yurtdışı trip |
| AI-26 | Trend Analizi | F-19 ile |
| AI-27 | Harita Notları | Map UX |

---

# PART 5 — CROSS-CUTTING TECHNICAL CONCERNS

## AI Altyapı Kararları (v3 Güncellemesi)

### Model Seçimi Stratejisi

| Kullanım | Model | Neden |
|----------|-------|-------|
| Hızlı parse/extract (filtre, kategori, tag) | Claude Haiku 4.5 | Düşük latency (~200ms), düşük maliyet |
| Reasoning + tool calling (asistan, trip planner) | Claude Sonnet 4.6 | Dengeli hız/kalite, güçlü tool use |
| Complex agentic (veri kalite ajanı, multi-step) | Claude Sonnet 4.6 | Extended thinking, güvenilir aksiyon |
| Vision (fotoğraf tanıma, menü OCR) | Claude Sonnet 4.6 | En iyi vision kalitesi |
| Fallback | GPT-4.1 / GPT-4o-mini | Provider downtime durumunda |

### API Key Stratejisi (v3)

| Aşama | Yaklaşım | Detay |
|-------|----------|-------|
| **Phase 1** | Server-side tek key | Sıfır UX friction, maliyet kontrol altında |
| **Phase 2** | Hybrid (free: server + limit, pro: server sınırsız) | Premium tier ile monetize |
| **Phase 3** | Vercel AI Gateway | Multi-provider, failover, cost tracking, A/B |

### Vercel AI SDK v6 Entegrasyon Planı

```typescript
// Temel kullanım pattern'i tüm AI endpoints için:
// Vercel AI Gateway üzerinden route edilir (provider/model formatı)

// 1. Streaming text (AI-02 chat, AI-12 journal)
import { streamText, stepCountIs } from 'ai';
import { gateway } from '@ai-sdk/gateway';

const result = streamText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  system: systemPrompt,
  messages,
  tools: { search_places, get_place_detail, ... },
  stopWhen: stepCountIs(5), // agentic loop
});

// 2. Structured output (AI-01 filter, AI-03 categorize, AI-06 sentiment)
import { generateText, Output } from 'ai';

const result = await generateText({
  model: gateway('anthropic/claude-haiku-4.5'),
  output: Output.object({ schema: placeFiltersSchema }), // Zod schema
  prompt: `Parse this query: "${userQuery}"`,
});

// 3. Vision (AI-10, AI-19, AI-21)
import { generateText } from 'ai';

const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4.6'),
  messages: [{
    role: 'user',
    content: [
      { type: 'image', image: base64Image },
      { type: 'text', text: 'Bu fotoğraftaki mekanı tanımla.' }
    ]
  }]
});
```

### Supabase Extension İhtiyaçları (v3)

| Extension | Feature | Mevcut mi? |
|-----------|---------|------------|
| `PostGIS` | Konum sorguları | ✅ Aktif |
| `pg_trgm` | Duplikat isim benzerliği (F-12) | ❌ Aktifleştirilmeli |
| `pgvector` | Embedding recommendation (AI-07 Seviye 2) | ❌ Aktifleştirilmeli |

### Yeni DB Tabloları Özeti (v3)

| Tablo | Feature | Kolonlar (özet) |
|-------|---------|-----------------|
| `saved_filters` | F-03 | user_id, name, filter_json |
| `list_shares` | F-11 | list_id, shared_with_user_id, permission |
| `trip_shares` | F-11 | trip_id, shared_with_user_id, permission |
| `place_votes` | F-11 | trip_id, place_id, user_id, vote |
| `activity_log` | F-14 | user_id, action, resource_type, resource_id, metadata |
| `notifications` | F-15 | user_id, type, title, body, read |
| `follows` | F-17 | follower_id, following_id |
| `map_annotations` | F-10 | user_id, location, text, emoji |
| `trip_templates` | F-24 | creator_id, name, city, duration_days, places |
| `trip_template_days` | F-24 | template_id, day_number, theme, places |
| `ai_conversations` | AI-23 | user_id, title |
| `ai_messages` | AI-23 | conversation_id, role, content, tool_calls |
| `ai_user_memory` | AI-23 | user_id, memory_type, content |

### Mevcut Tablo Değişiklikleri (v3)

| Tablo | Değişiklik | Feature |
|-------|-----------|---------|
| `places` | + `source: 'manual_pin' \| 'address_search' \| 'quick_save' \| 'web_clipper'` | F-01, F-05, F-07 |
| `places` | + `spent_amount decimal, currency text` | F-19 |
| `places` | + `reservation_date timestamptz` | F-15 |
| `places` | + `notify_on_nearby boolean` | F-08 |
| `trip_day_places` | + `journal_text text, journal_photos jsonb` | F-22 |
| `profiles` | + `preferred_language text` | F-16 |
| `profiles` | + `subscription_tier text` | F-25 |
| `profiles` | + `subscription_expires_at timestamptz` | F-25 |
| `profiles` | + `dietary_preferences text[]` | AI-14 |
| `google_data` JSONB | + `ai_summary text` | AI-05 |
| `google_data` JSONB | + `ai_sentiment jsonb` | AI-06 |
| `google_data` JSONB | + `ai_description jsonb` | AI-11 |
| `google_data` JSONB | + `ai_dietary jsonb` | AI-14 |
| `api_usage.sku` | + AI model SKU tipleri | AI-28 |

### Yeni API Endpoints Özeti (v3)

| Endpoint | Method | Feature |
|----------|--------|---------|
| `/api/places/export` | GET | F-06 |
| `/api/places/duplicates` | GET | F-12 |
| `/api/places/merge` | POST | F-12 |
| `/api/places/from-web` | POST | F-07 |
| `/api/places/nearby` | GET | F-08 |
| `/api/filters` | GET/POST/DELETE | F-03 |
| `/api/trips/[id]/ical` | GET | F-18 |
| `/api/templates` | GET/POST | F-24 |
| `/api/feed` | GET | F-17 |
| `/api/follows` | POST/DELETE | F-17 |
| `/api/subscription` | POST/GET | F-25 |
| `/api/ai/parse-query` | POST | AI-01 |
| `/api/ai/chat` | POST (stream) | AI-02 |
| `/api/ai/categorize` | POST | AI-03 |
| `/api/ai/suggest-tags` | POST | AI-04 |
| `/api/ai/summarize` | POST | AI-05 |
| `/api/ai/sentiment` | POST | AI-06 |
| `/api/ai/recommend` | GET | AI-07 |
| `/api/ai/import-enrich` | POST | AI-08 |
| `/api/ai/plan-trip` | POST (stream) | AI-09 |
| `/api/ai/vision` | POST | AI-10 |
| `/api/ai/describe-place` | POST | AI-11 |
| `/api/ai/generate-journal` | POST (stream) | AI-12 |
| `/api/ai/mood-discover` | POST | AI-13 |
| `/api/ai/dietary-match` | POST | AI-14 |
| `/api/ai/compare` | POST | AI-15 |
| `/api/ai/optimize-route` | POST | AI-16 |
| `/api/ai/estimate-budget` | POST | AI-17 |
| `/api/ai/group-plan` | POST | AI-18 |
| `/api/ai/curate-photos` | POST | AI-19 |
| `/api/ai/social-content` | POST | AI-20 |
| `/api/ai/food-recognize` | POST | AI-21 |
| `/api/ai/conversations` | GET/POST | AI-23 |
| `/api/ai/memory` | GET/POST/DELETE | AI-23 |
| `/api/ai/trend-report` | GET | AI-26 |
| `/api/ai/area-summary` | POST | AI-27 |
| `/api/cron/data-quality-agent` | POST | AI-22 |
| `/api/cron/discovery-agent` | POST | AI-24 |

---

# PART 6 — AI DETAYLI MALİYET & MİMARİ ANALİZ

## Maliyet Projeksiyonu (Server-Side Key)

### Senaryo: 100 Aktif Kullanıcı / Ay

| Feature | Model | Kullanım/Ay | Birim Maliyet | Toplam/Ay |
|---------|-------|-------------|---------------|-----------|
| AI-01 Doğal Dil Filtre | Haiku 4.5 | 5,000 sorgu | $0.0005 | $2.50 |
| AI-02 Agentic Asistan | Haiku+Sonnet | 3,000 tur | $0.008 avg | $24.00 |
| AI-03 Kategorilendirme | Haiku 4.5 | 1,500 mekan | $0.001 | $1.50 |
| AI-04 Etiket Önerisi | Haiku 4.5 | 1,500 mekan | $0.001 | $1.50 |
| AI-05 Review Özeti | Haiku 4.5 | 800 mekan | $0.002 | $1.60 |
| AI-06 Sentiment | Haiku 4.5 | 500 mekan | $0.003 | $1.50 |
| AI-07 Recommendations | Haiku+Sonnet | 1,000 set | $0.005 | $5.00 |
| AI-08 Akıllı Import | Haiku 4.5 | 300 mekan | $0.002 | $0.60 |
| AI-09 AI Trip Planner | Sonnet 4.6 | 200 plan | $0.05 | $10.00 |
| AI-10 Vision | Sonnet 4.6 | 200 görsel | $0.01 | $2.00 |
| AI-11 Açıklama Üretici | Haiku 4.5 | 500 mekan | $0.002 | $1.00 |
| AI-12 Journal Oluşturucu | Sonnet 4.6 | 50 journal | $0.03 | $1.50 |
| AI-13 Mood Discovery | Haiku 4.5 | 1,000 sorgu | $0.003 | $3.00 |
| AI-14 Diyet Uyumu | Haiku 4.5 | 300 mekan | $0.002 | $0.60 |
| AI-15 Karşılaştırma | Sonnet 4.6 | 200 | $0.01 | $2.00 |
| AI-16 Rota Optimizasyonu | Sonnet 4.6 | 100 | $0.01 | $1.00 |
| AI-17 Bütçe Tahmini | Haiku 4.5 | 150 | $0.003 | $0.45 |
| AI-18 Grup Koordinatör | Sonnet 4.6 | 50 | $0.02 | $1.00 |
| AI-19 Fotoğraf Küratör | Haiku 4.5 | 200 | $0.005 | $1.00 |
| AI-20 Sosyal İçerik | Haiku 4.5 | 500 | $0.001 | $0.50 |
| AI-21 Yemek Tanıma | Sonnet 4.6 | 100 | $0.01 | $1.00 |
| AI-22 Veri Kalite Ajanı | Haiku 4.5 | 5,000 (cron) | $0.001 | $5.00 |
| AI-23 Bellek Sistemi | Haiku 4.5 | 3,000 op | $0.001 | $3.00 |
| AI-24 Keşif Ajanı | Sonnet 4.6 | 400 (haftalık) | $0.01 | $4.00 |
| AI-25 Dil Asistanı | Sonnet 4.6 | 200 | $0.005 | $1.00 |
| AI-26 Trend Raporu | Haiku 4.5 | 100 | $0.003 | $0.30 |
| AI-27 Harita Notları | Haiku 4.5 | 1,000 | $0.001 | $1.00 |
| | | | **TOPLAM** | **~$77.55/ay** |

### Katmanlı Maliyet Senaryoları

| Senaryo | Aktif Özellikler | 100 Kullanıcı/Ay | 1,000 Kullanıcı/Ay |
|---------|-----------------|-------------------|---------------------|
| **Phase 1 (MVP)** | AI-01,03,04,05 | ~$7.10 | ~$71 |
| **Phase 2 (Intelligence)** | + AI-02,22,23 | ~$39.10 | ~$391 |
| **Phase 3 (Discovery)** | + AI-06,07,09,12,13 | ~$62.60 | ~$626 |
| **Phase 4 (Full)** | Tüm AI feature'lar | ~$77.55 | ~$775 |

### Break-Even Analizi

| Tier | Fiyat | AI Maliyeti/Kullanıcı | Margin |
|------|-------|----------------------|--------|
| Free (20 AI sorgu/ay) | $0 | ~$0.03 | -$0.03 |
| Pro ($4.99/ay) | $4.99 | ~$0.78 | +$4.21 |
| Team ($9.99/ay) | $9.99 | ~$1.50 | +$8.49 |

**Sonuç:** %10 Pro conversion ile bile AI maliyetleri karşılanır.

## Feature Bağımlılık Grafiği (v3)

```
                    AI-28 (AI Gateway)
                    ┌───────┴───────┐
                    │               │
          ┌────────┤               ├────────┐
          ▼        ▼               ▼        ▼
       AI-01    AI-03           AI-05     AI-10
       (NL)     (Cat)           (Sum)     (Vis)
        │        │ │             │         │
        ▼        ▼ ▼             ▼         ▼
      AI-02    AI-04 AI-08    AI-06     AI-21
      (Agent)  (Tag) (Imp)   (Sent)    (Food)
        │                      │
        ├──────┐               │
        ▼      ▼               ▼
     AI-23   AI-02           AI-15
     (Mem)   + tools         (Comp)
        │
        ▼
     AI-24
     (Disc)

  F-09 (D&D) ──→ F-10 (Trip) ──→ AI-09 (AI Trip) ──→ AI-16 (Rota Opt)
                                       │                    │
                                       ▼                    ▼
                                    AI-17 (Bütçe)        AI-18 (Grup)

  F-11a (Share) ──→ F-11 (Collab) ──→ F-17 (Social)
                                          │
                                          ▼
                                       AI-20 (Sosyal İçerik)

  F-14 (Stats) ──→ F-19 (Gelişmiş Stats) ──→ AI-26 (Trend)

  F-21 (Place Detail) ──→ AI-11 (Açıklama) + AI-14 (Diyet) + AI-27 (Harita)

  AI-07 (Recommend) + AI-13 (Mood) ──→ AI-24 (Keşif Ajanı)

  AI-22 (Veri Kalite) ← bağımsız (cron based)
  F-06 (Export) ← bağımsız
  F-07 (Clipper) ← bağımsız
  F-20 (Offline) ← bağımsız
  F-23 (Native) ← bağımsız (tüm feature'ları port eder)
  F-24 (Templates) ← bağımsız
  F-25 (Premium) ← bağımsız (tüm premium feature'ları gate'ler)
```

---

> **Özet:** Bu doküman **52 benzersiz feature önerisi** içerir:
> - **25 Non-AI Feature** (7 v2'den devir, 10 yeni, 8 v2'de implemente)
> - **27 AI Feature** (10 v2'den devir, 17 yeni)
>
> v2'ye göre AI feature sayısı **%170 artmıştır** (10 → 27).
> Toplam feature sayısı **%86 artmıştır** (28 → 52).
>
> Tahmini toplam AI maliyeti: 100 aktif kullanıcı ile **~$77.55/ay**.
> Pro tier conversion %10 ile **pozitif margin** sağlanır.
