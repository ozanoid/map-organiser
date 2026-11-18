---
title: "Faz 1 — Planlama ve ziyaretler: tasarım (öneri v2)"
type: plan
domain: trips
version: 2.1.0
last_updated: 18.11.2026
status: stable
related:
  - "[[personal-assistant]]"
  - "[[../01-domain/trips]]"
  - "[[../01-domain/lists]]"
  - "[[../01-domain/places]]"
  - "[[../05-flows/trip-planning-flow]]"
  - "[[../04-integrations/claude-mcp]]"
  - "[[../04-integrations/dataforseo]]"
---

# Faz 1 — Planlama ve ziyaretler: tasarım (öneri v2)

> **Tasarım onaylandı (Ozan, 18.11.2026); uygulama sürüyor** — bkz. [Uygulama durumu](#uygulama-durumu). [[personal-assistant]] planının Faz 1'i.
>
> v1 (17.11.2026) "planlar trip, tarihsiz hedefler liste, durağa durum alanı" öneriyordu. Ozan iki şey sordu: mevcut yapıyla kendimizi sınırlıyor muyuz, ve ad araması için Google Text Search şart mı. Bu sürüm modeli senaryolardan sıfırdan kurar, mevcut yapıyla farkını kanıtıyla gösterir ve geçiş yolunu verir.

## v1 neye yaslanmıştı

v1'de "arayüz hazır, şema değişikliği küçük" gerekçesi ağır basmıştı. Sıfırdan kurunca v1'in bir kısmı ilke olarak da doğru çıkıyor, bir kısmı yama:

| v1'deki öneri | Değerlendirme |
|---|---|
| Çıkış ve gezi aynı varlık | Doğru: içerikleri (tarih, sıralı duraklar, not), kurulma yöntemleri ve niyetleri aynı. |
| Tarihsiz hedef = liste | Doğru: davet, hatırlatma ve geri bildirim zamanı olan tek bir çıkışa bağlanır; "bu ay 3-4 restoran" ise birkaç ayrı çıkış doğuran bir kısa liste. |
| Yeni ayrı `plans` tabloları açmamak | Yönü doğru (ikinci planlama kavramı olmasın), biçimi yama: trip tabloları olduğu gibi kullanılmaz, tek plan modeline dönüştürülür. |
| Saati serbest metin `time_slot`'a yazmak | Yama. |
| Durağa `status`; gidilince mekana `visited` bayrağı | Yama: ziyaretin kendisi (tarih, puan, ne yendi) hiçbir yerde tutulmuyor. |
| Tarih hatasını ortak fonksiyonla kapatmak | Yama: hata, tarihin iki yerde tutulmasından doğuyor. |
| Claude'a plan silme tool'u | Zayıf: iptal geçmişi korur ve geri alınır. |
| Ad araması için Google Text Search | Gereksiz ikinci sağlayıcı — bkz. [Mekan arama ve ekleme](#mekan-arama-ve-ekleme). |

## Ne anladım

- Planı Claude kurar. Faz 1 onu kalıcı yapar: kaydet, platformda göster, Claude'dan geri oku, düzenle.
- Asistanın uzun vadeli hafızası yalnız planlar değil, **olmuş olanlar**: nereye, ne zaman gittin, nasıldı. Faz 4'ün geri bildirimi ve zevk profili buna dayanır.
- Model Faz 3'e (davet), Faz 4'e (geri bildirim) ve Faz 6'ya (keşif önerileri) yapısı değişmeden oturmalı.
- Kapsam dışı: davet ve bildirim gönderme (Faz 3), geri bildirim e-postası (Faz 4), uygulama içi asistanın Claude'a taşınması (Faz 2).

## Senaryolar

| # | Senaryo | Şekli |
|---|---|---|
| P1 | "Bu ay tek başıma 3-4 trendy restoran dene; yorumlara bak, ne yenir söyle" | Kısa liste + mekan başına not |
| P2 | "Perşembe 20:00 X'e gidiyorum" (Faz 3'te davetle) | Tek günlük, tek duraklı plan |
| P3 | "Cumartesi Shoreditch: brunch → kahve → bira" | Tek günlük, sıralı duraklı plan |
| P4 | "Barcelona'ya 3 gün, 12–14 Mart" | Çok günlü plan |
| P5 | "Planlarım ne?" | Yaklaşan ve geçmiş planlar |
| P6 | "Tatlıcı ekle / cumartesiyi pazara al / iptal et" | Düzenleme, kaydırma, iptal |
| P7 | "Gittim, 4 puan, kuzu çok iyiydi" | Ziyaret kaydı |
| P8 | "Şu yeri / Maps linkini / Instagram postunu kaydet" | Kütüphaneye ekleme |
| P9 | "3 günlük Barcelona planı yap" — tarih henüz yok | Gün yapısı olan, tarihi belli olmayan plan |
| P10 | "Geçen ay nerelere gittim? X'te en son ne yemiştim?" | Ziyaret geçmişi |
| P11 | Aynı yere ikinci, üçüncü kez gitmek | Ziyaret başına tarih, puan, not |
| P12 | "Önce Old Street çıkışında buluşalım, sonra …" | Kayıtlı mekanı olmayan durak |

## Tasarım ilkesi

- **Yapısal kararlar şimdi doğru verilir:** varlıklar, ilişkiler, tek doğruluk kaynağı, yazma yolu, adlar. Bunları sonradan değiştirmek pahalıdır.
- **Sonradan doldurulamayan bilgi şimdi tutulur:** kim oluşturdu (uygulama mı, asistan mı), ne zaman işaretlendi.
- **Yalnız eklemeli alanlar ihtiyaç doğunca gelir:** rezervasyon bilgisi, durak süresi, liste için son tarih, ziyaret fotoğrafı. Yapıyı bozmadan eklenir.

## Varlıklar

1. **Place** — kayıtlı mekan. Mevcut.
2. **List** — tarihsiz koleksiyon ya da kısa liste. Mevcut; öğe başına not eklenir (P1'de "ne yenir" bilgisi sohbetle birlikte kaybolmasın).
3. **Plan** — bir ya da birkaç günlük niyet: günler → sıralı duraklar. Çıkış ve gezi aynı varlık. Tarihi henüz belli olmayabilir.
4. **Visit** — olmuş olan: şu tarihte şu mekandaydım; puan, not. **Yeni.** Plandan doğabilir ya da plansız kaydedilir.

Ayırma gerekçeleri:
- *Liste ≠ plan:* listenin zamanı ve yaşam döngüsü yok; plan belirli bir zamana, kişilere ve sonuca bağlanır.
- *Ziyaret ≠ durak:* durak niyettir, ziyaret olgudur. Plansız ziyaret ve aynı yere tekrar ziyaret vardır.
- *Ziyaret ≠ mekandaki "visited" bayrağı:* bayrak "burada bulundum" bilgisidir ve tarihsiz de konabilir (eski ziyaretler, toplu işaretleme); ziyaret tarihli bir olaydır.

## Bugünkü yapıyla fark (kanıt)

| # | Bugün | Kanıt | Sorun | Kalıcı çözüm |
|---|---|---|---|---|
| 1 | Ziyaret, mekanın üstünde tek değer | `places.visit_status / visited_at / rating / notes` (canlı şema). `update_places` notu tarihli satır olarak mekanın notuna ekliyor: `src/lib/assistant/tools/update-places.ts:110` | Bir mekana birden çok ziyaret ve ziyaret başına puan / not tutulamıyor; geçmiş bir metin alanında birikiyor | `visits` tablosu |
| 2 | Saat serbest metin | `trip_day_places.time_slot text`; route `z.string().max(40)`: `src/app/api/trips/[id]/days/[dayId]/places/route.ts:118`; AI planlayıcı dört değer yazıyor: `src/lib/ai/schemas/trip-plan.ts:59` | Hatırlatma, davet ve takvim için kullanılamıyor | `start_time` + `day_part` |
| 3 | Tarih iki yerde | `trips.start_date / end_date` ve `trip_days.date` (hepsi NOT NULL) | `PATCH /api/trips/[id]` yalnız `trips`'i güncelliyor (`src/app/api/trips/[id]/route.ts:118-119`); günler eski tarihte kalıyor | Tek kaynak `plans.start_date`; günün tarihi türetilir |
| 4 | Tarih zorunlu | canlı şema | P9 kurulamıyor | `start_date` boş olabilir |
| 5 | Yazmalar atomik değil | Oluşturma üç ayrı insert, sonuncusunun hatası kontrol edilmiyor: `src/app/api/trips/route.ts:57-123`. AI planlayıcı önce silip gün gün ekliyor; yarım yazma ihtimalini kodun kendi yorumu söylüyor: `src/app/api/ai/trip-plan/route.ts:372-395` | Yarım plan kalabiliyor; Claude yeniden deneyince çift kayıt | Çok satırlı yazmalar tek Postgres fonksiyonunda |
| 6 | Durağın sonucu yok | canlı şema | Faz 4'ün "gittin mi?" cevabını yazacağı yer yok | `plan_stops.status` + ziyaret bağlantısı |
| 7 | İptal yok, yalnız silme | `DELETE /api/trips/[id]` | Geçmiş kayboluyor; Faz 3'te davetlilere iptal bildirilemez | `plans.status` |
| 8 | Durak yalnız kayıtlı mekan | `trip_day_places.place_id NOT NULL` | P12 kurulamıyor | `place_id` boş olabilir + `title` |
| 9 | Ad "trip" | tablolar, route'lar, sayfa | Perşembe yemeği "trip" oluyor; arayüz ve tool'lar "plan" derken kod "trip" diyecek | `plans / plan_days / plan_stops` |
| 10 | Şema değişikliklerinin SQL'i repoda yok | `supabase/` klasörü yok; `docs/_agent/common-tasks.md:30`; 56 migration yalnız Supabase'de kayıtlı | Şemanın geçmişi koddan izlenemiyor | Yeni migration SQL'leri repoda da durur |

## Hedef veri modeli

```
plans                      (bugünkü trips)
  id, user_id
  name
  start_date     date null            -- boş = tarihi henüz belli değil
  status         planned | cancelled
  party_size, notes, color, list_id   -- mevcut
  created_via    app | assistant
  created_at, updated_at
  -- end_date kalkar: start_date + gün sayısı − 1

plan_days                  (bugünkü trip_days)
  id, plan_id → plans
  day_number     1..N, plan içinde tekil
  notes, routing_profile              -- mevcut
  -- date kalkar: plans.start_date + (day_number − 1)

plan_stops                 (bugünkü trip_day_places)
  id, day_id → plan_days
  sort_order
  place_id       → places, boş olabilir
  title          kayıtlı mekanı olmayan durak için (place_id ya da title zorunlu)
  start_time     time null            -- mekanın yerel saati
  day_part       morning | afternoon | evening | night   (start_time yoksa)
  notes, cost_estimate, currency      -- mevcut
  status         planned | done | skipped
  status_at

visits                     (yeni)
  id, user_id
  place_id       → places
  visited_on     date                 -- mekanın yerel tarihi
  rating         1..5, boş olabilir
  notes          ne yedim, nasıldı
  plan_stop_id   → plan_stops, boş olabilir, tekil
  created_via    app | assistant | feedback
  created_at, updated_at

list_places.note           yeni sütun
places.source              + 'assistant'
import_jobs.kind           + 'assistant'
shared_links.resource_type 'trip' → 'plan'
```

Kurallar:
- **Tarih tek yerde.** Günün tarihi ve planın bitişi hesaplanır; API hazır döndürür. Planı kaydırmak tek satırlık güncellemedir; günlerin sırasını değiştirmek yalnız `day_number` değiştirir.
- **Zaman yapısal.** Tam saat ya da günün bölümü; ikisi birden olmaz. Saat mekanın yerel saatidir; kesin an gerektiğinde (hatırlatma) mekanın saat dilimiyle hesaplanır.
- **"Gittim" bir ziyarettir.** Durak `done` olur ve mekanı varsa aynı işlemde bir `visits` satırı oluşur. Plansız ziyaret de kaydedilir.
- **Mekanın özeti ziyaretle güncellenir.** `visit_status` → `visited` (mekan `favorite` ise dokunulmaz); puan verildiyse `rating`. Bayrak ziyaretsiz de konabilir.
- **Gün çıkarma yalnız boş günde.** Dolu gün çıkarılmak istenirse işlem reddedilir ve neden söylenir; veri sessizce kaybolmaz.
- **Mekan silinince** durakları ve ziyaretleri de silinir (bugünkü davranış); silme öncesi uyarı ziyaretleri de sayar.

## Yazma yolu

- **Ortak modül** `src/lib/plans/`: route'lar ve tool'lar aynı fonksiyonları çağırır; iş kuralı tek yerde.
- **Atomik yazma:** çok satırlı işlemler Postgres fonksiyonunda, tek transaction'da — `create_plan`, `apply_plan_changes`, `log_visit`. `SECURITY INVOKER`; RLS geçerli kalır. Emsal: `claim_import_items`, `increment_api_usage`.
- **Migration'lar repoda:** SQL `supabase/migrations/` altında durur, Supabase'e aynı adla uygulanır.

## Tool'lar

| Tool | Tür | Ne yapar | Senaryo |
|---|---|---|---|
| `get_plans` | okuma | Yaklaşan / geçmiş / tarihi belli olmayan / tüm planlar. `plan_id` ile tam detay: günler ve tarihleri, duraklar, saat, durum, bağlı ziyaret; istenirse günlük rota (Mapbox). | P5 |
| `create_plan` | yazma | Ad, başlangıç tarihi (boş olabilir), günler ve duraklar (mekan ya da başlık; saat ya da gün bölümü; not), kişi sayısı. Tek işlemde. | P2–P4, P9, P12 |
| `update_plan` | yazma | Ad, not, kişi sayısı; tarihi belirle, kaydır ya da kaldır; iptal et ya da geri al; gün ekle, çıkar, sırala; durak ekle, çıkar, taşı, saatini ve notunu değiştir, atlandı işaretle. Tek işlemde. | P6 |
| `log_visit` | yazma | "Gittim": mekan, tarih (varsayılan bugün), puan, not. O tarihte planlı durağı varsa bağlar ve `done` yapar. `visit_id` ile düzeltme. | P7, P11 |
| `get_visits` | okuma | Ziyaret geçmişi: tarih aralığı, mekan, şehir, puan. | P10 |
| `save_list` | yazma | Liste oluştur, adını ve açıklamasını değiştir; mekan ekle ya da çıkar; öğe notu. | P1 |
| `search_google_maps` | okuma, ücretli | Google Maps'te arama: sorgu + konum → adaylar (ad, adres, puan, yorum sayısı, kategori, Maps linki, kütüphanede var mı). | P8 |
| `add_place` | yazma | Maps linki, arama sonucundaki aday ya da Instagram postu → kütüphaneye ekler (mevcut zenginleştirme kuyruğu). | P8 |

- **Silme tool'u yok:** Claude planı iptal eder; plan ve liste silme yalnız arayüzden.
- **Mevcut tool'larda değişiklik:**
  - `update_places`: `note` artık ziyaret günlüğü değil, mekan hakkında genel not; "gittim" `log_visit`'e gider.
  - `get_places`: son ziyaretleri ve mekanın geçtiği yaklaşan planları da döndürür.
  - `get_library_overview`: ziyaret sayılarını da verir.
- **Server instructions'a eklenecekler:** kaydetmeden önce planı özetle ve onay al; kaydedince platform linkini ver; "gittim" denince `log_visit`.

## Mekan arama ve ekleme

**Google "Text Search" nedir.** Google Places API'nin mekan araması — Google Maps'te arama yapmanın API hali. Web araması değil.

**Fiyatı** (Google'ın resmi fiyat sayfası, 18.11.2026): istek başına ücretlenir, aylık sabit ücret yok.

| Kademe | Aylık ücretsiz | Sonrası (1.000 arama) | Hangi alanlar |
|---|---|---|---|
| Pro | 5.000 | $32 | ad, adres, konum, Maps linki, tür |
| Enterprise | 1.000 | $35 | + puan, telefon, web sitesi |

**Ölçülen kullanım** (`api_usage`): Kasım 2026'da ozan@maporganiser.com'da 3 Enterprise arama (Instagram importu), Ekim'de test hesabında 114. Ücretli dilime hiç girilmedi.

**DataForSEO "Google Maps SERP"** (dokümanı ve fiyat sayfası, 18.11.2026): `POST /v3/serp/google/maps/live/advanced`; istek başına $0.002 (100 sonuca kadar); abonelik yok, ön ödemeli bakiyeden düşer. Her sonuçta ad, adres, `cid`, `place_id`, koordinat, puan ve yorum sayısı, kategori, telefon, web sitesi.

- **Canlı doğrulandı (18.11.2026):**
  - "DanDan Aldgate" → tek sonuç; `cid` veritabanındaki kayıtla aynı (9577570098796810468).
  - "Dishoom" (Londra) → 11 şube, adres ve puanlarıyla ayrı ayrı.
  - "ramen" (Shoreditch, dar alan) → 20 sonuç; ilk ikisi ramen, sonrası yakındaki başka restoranlar. Tür aramasında kategoriye bakmak gerekiyor.
  - Ücret yanıtın kendi `cost` alanında: arama başına $0.002. Süre 2,6–12,4 sn.
  - `price_level` canlı yanıtlarda boş geliyor; arama sonuçlarında fiyat seviyesi yok.

**Öneri:** arama bir `PlaceSearch` arayüzünün arkasında durur; sağlayıcısı DataForSEO.
- Zenginleştirme zaten DataForSEO'da; aramanın döndürdüğü `cid`, ekleme hattının kullandığı anahtarın aynısı.
- Tek sağlayıcı, tek bakiye; Google'ın ücretsiz kotasına bağımlılık yok.
- Faz 5'teki toplu Instagram importu için de aday: Instagram importu bugün post başına yaklaşık 3 Enterprise arama yapıyor (tek ölçüm). Koleksiyonun boyutu bilinmiyor; örneğin 500 post ≈ 1.500 arama, Google'da ücretsiz kotayı aşan 500 arama ≈ $17.50, DataForSEO'da toplam ≈ $3. Geçiş kararı etiketli 35 postluk eval setiyle ölçülerek verilir — ayrı adım.

**Claude'un web araması** tamamlayıcıdır: yazı, menü, haber bulur; Google Maps kimliği (`cid`) vermez, bu yüzden ekleme hattını tek başına besleyemez. Bir sayfada Maps linki bulursa `add_place` onu doğrudan alır.

**Ekleme (`add_place`):**
- Maps linki ya da arama adayı (`cid`) → zaten kayıtlı mı? Değilse kuyruğa tek öğe (`kind = assistant`); yer oluşana kadar ~20 sn beklenir, fotoğraf / yorum / profil arka planda tamamlanır.
- Instagram postu → mevcut Instagram import işi; eklenen ve atlanan mekanlar döner.

**Ek bulgu:** SKU kaydında `text_search_pro` 1.000'de $17 yazıyor (`src/lib/google/track-usage.ts:6`); resmi sayfada $32. Maliyet ekranı Pro kotası aşılırsa eksik gösterir; diğer Google SKU fiyatları da kontrol edilmeli.

## Arayüz

- **Plans** sekmesi ve `/plans/[id]`: mevcut trip sayfası yeni modele uyarlanır. Ek olarak: tarihi belli olmayan plan durumu ("Tarih belirle"), saat alanı (saat ya da gün bölümü), durak durumu, iptal edilmiş plan görünümü, mekansız durak satırı. `/trips/<id>` adresleri yeni adrese yönlenir.
- **Mekan detayı:** "Ziyaretler" bölümü ve "Ziyaret ekle" (tarih, puan, not). Durum düğmesi ve yıldızlar yerinde kalır.
- **Liste detayı:** öğe notu.
- UX ayrıntıları kod öncesinde ayrıca netleştirilir.

## Geçiş ve regresyon

- **Kapsam:** 19 kaynak dosya — 8 trip route'u, plan sayfası, hook, tipler, Lists sayfası, AI planlayıcı (gün tarihini okuyor: `src/app/api/ai/trip-plan/route.ts:183-185, 257`), gün takası (`…/swap-days/route.ts:46-47`), paylaşım okuma / kaydetme / sayfa (`src/app/api/shared/[slug]/save/route.ts:240-264`), mekan silme kontrolleri (`src/app/api/places/[id]/route.ts:51`, `src/app/api/places/bulk/route.ts:175-177`). 33 doküman.
- **Veri:** 7 trip (iki hesapta; ozan@maporganiser.com'da yok), 40 gün, 127 durak, 2 paylaşım linki.
  - `time_slot` değerleri: boş 102, morning 7, afternoon 9, evening 6, night 3 → `day_part`'a kayıpsız taşınır.
  - `visited_at` hiçbir mekanda dolu değil → geriye dönük ziyaret üretilmez.
- **Veritabanı:** Postgres 17.6; trip tablolarına dokunan fonksiyon yok; üç RLS policy tablolarla birlikte taşınır.
- **Davranış değişiklikleri:**
  - Plan tarihi değişince günler de kayar (bugün kaymıyor).
  - Oluşturma formu başlangıç + gün sayısı ister; tarih boş bırakılabilir.
  - Paylaşım linkleri aynı adresle çalışır.
- **Yayın — üç adım, kesintisiz** (18.11.2026'da değişti; önceki öneri tabloları yeniden adlandırmak ve 1–2 dakikalık kesintiyi kabul etmekti):
  1. *Genişlet:* yeni tablolar eklenir ve mevcut trip satırları aynı id'lerle kopyalanır. Çalışan kod eski tablolarda devam eder; yeni kod gerçek veriyle test edilir.
  2. *Geç:* yeni kod yayınlanır; arada eklenen trip varsa son kez kopyalanır, paylaşım linklerinin türü `plan` olur. Yeni kod geçiş boyunca `trip` türünü de kabul eder.
  3. *Daralt:* doğrulamadan sonra eski üç tablo silinir — kalıcı silme, ayrıca onay alınır.
  - Yeni tablolar temiz adlarla ve index'lerle doğar (eski tablolarda birincil anahtar dışında index yok). Geri dönüş: 2. adıma kadar yeni tabloları silmek yeter.
- **Doğrulama:** `npm run check:assistant`'a plan ve ziyaret senaryoları; tarayıcıda plan sayfası (oluştur, kaydır, gün ekle-çıkar, durak taşı, AI plan, paylaşım); canlıda connector üzerinden P1–P12.

## Dilimler (sırayla)

1. **Plan modeli dönüşümü:** migration, ortak modül, route / sayfa / hook uyarlaması. Yeni özellik yok; davranış aynı, tarih tutarlı.
2. **Ziyaretler:** tablo, `log_visit`, mekan sayfasında ziyaretler, `log_visit` / `get_visits` tool'ları, `update_places` düzeltmesi.
3. **Plan tool'ları:** `get_plans`, `create_plan`, `update_plan`.
4. **Listeler:** öğe notu, `save_list`.
5. **Arama ve ekleme:** DataForSEO sağlayıcısı, `search_google_maps`, `add_place`.

Her dilim kendi başına tamamdır ve ayrı doğrulanır.

## Sonraki fazlara oturuşu

- **Faz 3 (davet):** `plan_invites` `plans`'e bağlanır; davet sayfası planın tarihini, saatlerini ve duraklarını gösterir; iptal `plans.status` ile bildirilir.
- **Faz 4 (geri bildirim):** tarihi geçmiş ve durumu `planned` kalan duraklar e-postayla sorulur; cevap `log_visit` (`created_via = feedback`) ya da `skipped` olur. Fotoğraf `visits`'e bağlanır.
- **Zevk profili:** Faz 0'da veri olmadığı için çıkarılmıştı; ziyaretler biriktikçe `get_library_overview` üzerinden geri gelir.
- **Faz 6 (keşif):** onaylanan öneriler `add_place` ile aynı kuyruktan girer.

## Değerlendirilip seçilmeyenler

- **Trip'i olduğu gibi kullanmak (v1-A):** yukarıdaki on farkın sekizi kalır.
- **Trip'in yanına yeni `plans` tabloları (v1-B):** iki planlama kavramı, çift arayüz.
- **Tarihi durağa yazmak, gün varlığını kaldırmak:** gün notu, rota modu, boş gün, gün sıralama ve tarihsiz gün yapısı (P9) kaybolur.
- **Gün tarihini saklayıp trigger ile eşitlemek:** iki kaynak kalır; hata sınıfı kapanmaz.
- **Tarihsiz hedefi plan içinde "tarihsiz durak" yapmak:** davet ve hatırlatma tek bir çıkışa bağlanır; ay hedefi birkaç ayrı çıkış doğurur.
- **Ziyareti yalnız durak durumuyla tutmak:** plansız ziyaret ve tekrar ziyaret tutulamaz.
- **Eski tablo adlarını view olarak bırakmak:** tek kullanıcı için atılacak karmaşıklık; yerine kısa bir yayın penceresi.
- **Google Text Search (Pro kademesi):** ücretsiz kotası yeterli, ama ikinci sağlayıcı; DataForSEO canlı doğrulamada yetersiz çıkarsa yedek.

## Kararlar (Ozan, 18.11.2026)

Altı karar da onaylandı:

1. Trip tabloları tek `plans` modeline dönüşür (ad dahil), `visits` eklenir, listeler ayrı kalır.
2. Kayıtlı mekanı olmayan duraklar olur.
3. Claude plan silmez, iptal eder; silme yalnız arayüzden.
4. Mekan arama DataForSEO'dan; Google Text Search Faz 1'e girmez.
5. Yayın sırasında kısa bir kesinti kabul — ama artık gerekmiyor, bkz. [Yayın](#geçiş-ve-regresyon).
6. DataForSEO bilgileri yerel `.env.local`'e eklendi (Ozan); canlı doğrulama yapıldı.

Migration SQL'i uygulanmadan önce gösterilir.

## Uygulama durumu

| Dilim | Durum (18.11.2026) |
|---|---|
| Şema (dilim 1, 2, 4 ve 5'in tabloları) | SQL yazıldı: `supabase/migrations/20261118090000_plans_tables.sql`, `…090100_visits.sql`, `…090200_list_place_notes.sql`, `…090300_assistant_source.sql`. **Uygulanmadı — Ozan'ın onayını bekliyor.** Henüz çalıştırılmadı. |
| 1 Plan modeli dönüşümü | Bekliyor (şema onayı) |
| 2 Ziyaretler | Bekliyor |
| 3 Plan tool'ları | Bekliyor |
| 4 Listeler | Bekliyor |
| 5 Arama ve ekleme | `search_google_maps` yazıldı ve canlı veriyle doğrulandı (dalda). `add_place` şema onayını bekliyor. |
