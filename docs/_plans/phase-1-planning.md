---
title: "Faz 1 — Planlama: tasarım (öneri)"
type: plan
domain: trips
version: 1.0.0
last_updated: 17.11.2026
status: draft
related:
  - "[[personal-assistant]]"
  - "[[../01-domain/trips]]"
  - "[[../01-domain/lists]]"
  - "[[../05-flows/trip-planning-flow]]"
  - "[[../04-integrations/claude-mcp]]"
---

# Faz 1 — Planlama: tasarım (öneri)

> **Ozan'ın onayını bekliyor (17.11.2026). Kod yok.** [[personal-assistant]] planının Faz 1'i; Faz 0'ın tool katmanının ([[../04-integrations/claude-mcp]]) üstüne kurulur.

## Ne anladım

- Planı Claude kurar (claude.ai, Claude Code; Faz 2'den sonra uygulama asistanı). Faz 1'in işi planı **kalıcı** yapmak: kaydet, platformda göster, Claude'dan geri oku, düzenle.
- Planlama zekâsı modelde kalır; tool'lar veri ve eylem sağlar.
- Model Faz 3'e (davet / katılıyorum-katılmıyorum) ve Faz 4'e (geri bildirim e-postası) hazır olmalı: durağın tarihi, saati ve durumu (gidildi / atlandı) tutulmalı.
- Kapsam dışı: bildirim ve davet gönderme (Faz 3), geri bildirim e-postası (Faz 4), uygulama içi asistanın Claude'a taşınması (Faz 2).

## Senaryolar

| # | Senaryo | Şekli | Gerekenler |
|---|---|---|---|
| P1 | "Bu ay tek başıma 3-4 trendy restoran dene" | Tarihsiz hedef: bir dönemde denenecek birkaç yer | Seçilen yerler, tarihsiz kayıt, gidildi mi |
| P2 | "Perşembe akşamı X'e gidiyorum" (Faz 3'te davetle) | Tek seferlik çıkış: tarih, saat, 1–2 durak | Tarih, saat, not |
| P3 | "Cumartesi Shoreditch: brunch → kahve → bira" | Günlük rota: bir tarih, sıralı duraklar | Sıra, saatler, yürüme mesafesi |
| P4 | "Barcelona'ya 3 gün" | Çok günlü gezi | Günler, duraklar, rota |
| P5 | "Planlarım ne? / Geçen hafta ne yapmıştım?" | Okuma | Yaklaşan ve geçmiş planlar |
| P6 | "Perşembe planına tatlıcı ekle / cumartesiyi pazara al / iptal et" | Düzenleme | Durak ekle-çıkar-taşı, tarih kaydır, sil |
| P7 | "Gittim, kuzu çok iyiydi" (Faz 4'ün başlangıcı) | Durak tamamlandı | Durak durumu + mekanın ziyaret durumu |
| P8 | "Web'de bulduğun şu yeri / bu Maps linkini / şu Instagram postunu kaydet" | Kütüphaneye ekleme | Ekleme hattı |

## Bugünkü durum (kanıt)

- **Trip modeli:** `trips` → `trip_days` (aralıktaki her tarih için bir satır) → `trip_day_places` (sıra, serbest metin `time_slot`, `notes`, kişi başı maliyet). `start_date` ve `end_date` zorunlu (canlı şema: NOT NULL). Ayrıntı: [[../01-domain/trips]].
- **Arayüz hazır:** Lists sayfasında "My Trips" sekmesi; `/trips/[id]` zaman çizelgesi + harita + günlük Mapbox rotası + maliyet + paylaşım + otomatik ve AI planlama.
- **Oluşturma mantığı route'un içinde:** `src/app/api/trips/route.ts` POST — tool'un aynı mantığı kullanması için ortak fonksiyona çıkarılmalı.
- **Tarih hatası:** `PATCH /api/trips/[id]` yalnız `trips` satırını güncelliyor (`src/app/api/trips/[id]/route.ts`); `trip_days.date` eski tarihte kalıyor. [[../05-flows/trip-planning-flow]] bunu açık soru olarak tutuyordu.
- **Durak durumu yok:** gidildi / atlandı tutulmuyor; yalnız mekanın genel `visit_status`'ü var.
- **Listeler:** `lists` + `list_places` — tarihsiz, sıralı koleksiyon.
- **Ozan'ın hesabı:** 0 liste, 0 trip (diğer hesaplarda test trip'leri var).
- **Ekleme hattı:** kuyruk (`import_jobs` / `import_job_items`). Öğede `googleMapsUrl` varsa drain CID / place_id'yi çözüp DataForSEO ile zenginleştiriyor (`resolveIdentity`, `src/lib/import/process-place.ts`). `import_jobs.kind` yalnız `takeout` / `instagram` kabul ediyor (CHECK). Instagram importu işi route içinde açıp `after()` ile koşuyor. Ad + şehir araması için `searchPlaceCandidates` (Google Text Search) var.

## Plan nerede tutulsun?

### A — Planlar trip, tarihsiz hedefler liste (önerilen)

- P2–P4 trip olur. Tek duraklı perşembe akşamı = 1 günlük, 1 duraklı trip; cumartesi rotası = 1 günlük çok duraklı trip; Barcelona = 3 günlük trip.
- P1 liste olur ("Kasım — tek başıma denenecekler"). Tarih kesinleşen yer bir çıkış planına (trip) dönüşür.
- **Artısı:** arayüz, harita, rota, paylaşım, maliyet ve AI planlayıcı hazır; platformda tek planlama kavramı; şema değişikliği küçük.
- **Eksisi:** "Trip" adı bir akşam yemeği için tuhaf — arayüzde "Plans" denebilir (karar 2). Tarihsiz hedef ayrı bir kavramda (liste) duruyor.

### B — Yeni `plans` + `plan_items` tabloları

- Tür alanı (çıkış / gün / gezi / hedef), tarihi opsiyonel duraklar, durum, ileride katılımcılar.
- **Artısı:** dört senaryo tek modelde.
- **Eksisi:** trips'in ikinci kopyası — arayüz, rota, paylaşım, maliyet baştan yazılır; platformda iki planlama kavramı; çok daha büyük iş.

**Öneri: A.** B'nin tek gerçek üstünlüğü tarihsiz hedef; onu liste zaten karşılıyor.

## Önerilen tasarım (A)

### Veri modeli — migration, onay gerekir

1. `trip_day_places.status` — `text not null default 'planned'`, CHECK `planned | done | skipped`; `trip_day_places.status_at` — `timestamptz null`. Faz 4'ün "gittin mi?" sorusu bu alanla yapılır.
2. `places.source` CHECK'ine `assistant`, `import_jobs.kind` CHECK'ine `assistant` — Claude'un eklediği yerler ayrı izlenir.

Başka tablo yok. Katılımcılar ve davet Faz 3'te, geri bildirim Faz 4'te bu yapının üstüne eklenir.

### Ortak plan mantığı — `src/lib/trip/`

- `createTrip`: `POST /api/trips`'ten çıkarılır; route ve tool aynı fonksiyonu kullanır.
- `setTripDates`: tarih kayınca günler de kayar (Pazartesi → Salı). Süre uzarsa gün eklenir. Süre kısalırsa ve silinecek günlerde durak varsa işlem **reddedilir** ve neden söylenir — veri sessizce kaybolmaz (karar 5). `PATCH /api/trips/[id]` de bunu kullanır, böylece arayüzdeki tarih hatası da kapanır.
- `setStopStatus`: durak `done` olunca mekanın ziyaret durumu `visited` olur (mekan `favorite` ise dokunulmaz) — karar 3.

### Tool'lar — Faz 0 katmanına eklenir

| Tool | Ne yapar | Senaryo | Tür |
|---|---|---|---|
| `get_plans` | Yaklaşan / geçmiş / tüm planlar: ad, tarihler, durak sayısı, yapılan-atlanan, platform linki. `plan_id` ile tam detay: günler, duraklar (saat, not, durum); istenirse günlük yürüme rotası (Mapbox, ücretli). | P5 | okuma |
| `create_plan` | Ad, tarih(ler), duraklar (mekan, gün, saat `HH:MM` ya da sabah/öğle/akşam/gece, not), kişi sayısı → trip + günler + duraklar. Platform linkini döndürür. | P2–P4 | ekleme |
| `update_plan` | Ad / not değiştir, tarihleri kaydır, durak ekle-çıkar-taşı, durakların saat / not / durumunu güncelle. | P6, P7 | değiştirme |
| `delete_plan` | Planı siler; geri alınmaz, claude.ai onay sorar (karar 6). | P6 | silme |
| `save_list` | Liste oluştur, ad / açıklama değiştir, mekan ekle-çıkar. Liste silme yok (arayüzden). | P1 | ekleme |
| `add_place` | Google Maps linki, Instagram postu ya da ad + şehir → kütüphaneye ekler. Ad aramasında tek net aday yoksa adayları döndürür; yer zaten kayıtlıysa onu gösterir. | P8 | ekleme |

**Server instructions'a eklenecekler:**
- Planı kaydetmeden önce kullanıcıya özetle ve onay al.
- Saatleri `HH:MM` yaz.
- Kaydedince platform linkini ver.
- "Gittim" denince durağı `done` yap.

### `add_place` ayrıntısı

- **Maps linki:** mevcut çözümleyici (kısa linkler dahil) → zaten kayıtlı mı (CID / place_id)? Değilse kuyruğa tek öğe (`kind = assistant`) + drain tetiklenir. Tool yer oluşana kadar ~20 sn bekler ve döndürür; fotoğraf, yorum ve profil arka planda tamamlanır.
- **Instagram linki:** mevcut Instagram import işi. Route içindeki iş açma ortak fonksiyona çıkarılır. Tool okuma bitene kadar bekler (5–25 sn); eklenen ve atlanan mekanları döndürür.
- **Ad + şehir:** Google Text Search (Instagram importunun kullandığı). Tek güçlü aday varsa eklenir. Yoksa en fazla 5 aday döner, Claude sana sorar, seçilen aday Maps linkiyle eklenir.
- **Maliyet:** normal bir eklemeyle aynı (DataForSEO işletme bilgisi + yorumlar, Gemini profili); ad aramasında ek olarak Text Search, $35 / 1.000 (karar 7).

### Arayüz — küçük

- Trip detayında durak durumu çipi: Planlandı / Gidildi ✓ / Atlandı. Küçük bir menüyle değiştirilir; gidilen duraklar soluk ve tikli görünür.
- Lists sayfasındaki "My Trips" sekmesinin adı "Plans" olur (karar 2). Yaklaşan planlar üstte, geçmişler altta.
- Başka yeni ekran yok; plan detay sayfası mevcut trip sayfası.

### Doğrulama

- `npm run check:assistant`'a eklenecek senaryolar:
  - tek duraklı çıkış, günlük rota, 3 günlük gezi;
  - tarih kaydırma ve kısaltmanın reddi;
  - durak `done` → mekan `visited`;
  - liste;
  - `add_place` (Maps linki, ad + şehir).
- Yazmalar test hesabında yapılır ve geri alınır.
- Canlıda P1–P8, connector üzerinden.

### Bitti tanımı

claude.ai'da:
- "Bu ay tek başıma 3-4 trendy restoran" → liste kaydedildi.
- "Perşembe 20:00 DanDan" → plan kaydedildi, platformda görünüyor, link açılıyor.
- "Cumartesiye al" → günler kaydı.
- "Gittim" → durak `done`, mekan `visited`.
- "Şu Maps linkini kaydet" → yer kütüphanede.

## Açık kararlar

1. Model A (trip + liste) mı, B (yeni tablolar) mı? — öneri **A**.
2. Arayüzde "My Trips" sekmesinin adı "Plans" olsun mu? — öneri **evet**.
3. Durak "gidildi" olunca mekan otomatik "visited" olsun mu? — öneri **evet**.
4. Migration: `trip_day_places.status` / `status_at` + `places.source` ve `import_jobs.kind`'e `assistant` — onay.
5. Plan kısalırsa silinecek günlerdeki duraklar: reddet ve sor mu, son güne taşı mı? — öneri **reddet ve sor**.
6. Claude plan silebilsin mi (claude.ai'ın onay sorusuyla)? — öneri **evet**; liste silme yalnız arayüzden.
7. `add_place`'in ad aramasında Google Text Search (admin anahtarı, $35 / 1.000) — onay.
