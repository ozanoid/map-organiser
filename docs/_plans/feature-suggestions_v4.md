---
title: "Feature Suggestions v4"
type: plan
domain: overview
version: 4.1.0
last_updated: 15.07.2026
status: stable
related:
  - "[[../_archive/feature-suggestions_v2]]"
  - "[[../_archive/feature-suggestions_v3]]"
  - "[[../_archive/feature-suggestions_v3-ai-first]]"
  - "[[backfill-grandfather-reenrich]]"
  - "[[../05-flows/ai-enrichment-flow]]"
  - "[[../05-flows/ai-search-flow]]"
  - "[[../CHANGELOG]]"
tags:
  - roadmap
  - backlog
---

# Map Organiser — Feature Suggestions v4

> **Tarih:** 14.07.2026
> **Kaynaklar:** `feature-suggestions_v2.md` + `feature-suggestions_v3.md` + `feature-suggestions_v3-ai-first.md` (hepsi `_archive/`), Mayıs 2026 AI sprinti git geçmişi (PR #28–#49), vault v1.11.0.
> **Yöntem:** Üç roadmap dokümanı, Mayıs sprintinde implemente edilenlerle karşılaştırıldı; durum senkronlandı, kalan backlog mevcut altyapıya göre yeniden fiyatlandırılıp önceliklendirildi.
>
> **Numaralandırma:** v3'ün `F-xx` / `AI-xx` numaraları kanonik (git geçmişi bu numaraları kullanıyor — ör. "Phase 6 — AI-01"). v3-ai-first'ün `NF-xx` serisi ayrı seri olarak korunur. v3-ai-first'ün KENDİ `AI-xx` numaraları ÇAKIŞIR ve **kullanılmaz** — eşleştirme tablosu PART 5'te.

---

## Doküman Yapısı

```
PART 0 — v3'ten bu yana ne oldu (Mayıs 2026 AI sprinti)
PART 1 — Tam durum matrisi (✅ / 🟡 / 🔄 / ❌)
PART 2 — v4 Öncelikli Backlog (tema bazlı kürasyon)
PART 3 — Önerilen Sprint Planı
PART 4 — Teknik Borç & Bakım
PART 5 — Ekler (numara eşleştirme, karar kayıtları)
```

---

# PART 0 — v3'ten Bu Yana Ne Oldu

v3 dokümanları 17.04.2026'da yazıldı. 13–20 Mayıs arasında tek bir yoğun sprint,
v3'ün "Phase 1 + Phase 2'nin yarısı" kapsamını ve fazlasını üretti. 20 Mayıs
sonrası yalnızca dependabot güncellemeleri geldi (30 Haziran).

## 0.1 Sprint'te implemente edilenler

| ID | Feature | Nasıl | Referans |
|----|---------|-------|----------|
| F-01 *(yarısı)* | Mekan arama ile ekleme | Mapbox Search Box → suggest/retrieve → kaydet + enrich zinciri | PR #28, [[../05-flows/place-search-flow]] |
| AI-01 | Doğal dil arama | Phase 6 + **6.5 LLM-as-judge pivotu**: parse-query (hard filtre + semantic_intent) → rank-results (profil üzerinden 0-1 skor + why + hide-power) + adaptive broaden | PR #39, #43, #44, v1.8.x; [[../05-flows/ai-search-flow]] |
| AI-03 | Akıllı kategorizasyon | İki katman: lite (kural-tabanlı, kayıt anında) + full profil `category_signals` + **Phase 5.5 kategori-uyuşmazlık itirazı** (moderation queue'ya `category_change`) | PR #30–#35 |
| AI-04 | Otomatik etiket önerisi | Lite chips (dialog, opt-in) + full profil `suggested_tags` → 4-bant auto-apply + moderation queue + fuzzy dedup | PR #33–#35 |
| AI-05 | Mekan özeti / review sentezi | `place_profile`: tldr, pros/cons, theme_insights, searchable_summary → `AiSummaryCard` | PR #34 |
| AI-06 *(kısmen)* | Sentiment analizi | `theme_insights`: 8 tema × sentiment × mention_count × salience × evidence quotes (≥3 mention barajı) — bkz. 1.2 | PR #34 |
| — | **Sub-category taksonomisi** (roadmap'te yoktu) | Kullanıcı-bazlı alt kategoriler, 62-slug default sözlük, cascade filtre | PR #32 |
| — | **AI moderation queue** (roadmap'te yoktu) | `ai_suggestions_queue` + Settings → AI onay UI'ı; tag / sub-cat / category_change | PR #35 |
| — | Profil backfill | Settings → AI paneli + import done ekranı; eski mekanlara tek tıkla profil | PR #42, #48 |
| — | Observability | Honeycomb OTel-native + AI arama pipeline'ı tek trace (traceparent propagation) + 2 board | PR #47, [[../05-flows/observability-flow]] |
| — | AI cost cap | `AI_DAILY_CALL_CAP=3000`/kullanıcı/gün → 429, fail-open (15.07.2026'da aylık 500'e çevrildi) | PR #49, v1.11.0 |
| — | Bakım | city=admin-region düzeltmesi + UK backfill (#41), kategori dedupe runbook (#40) | |

## 0.2 Spec'ten bilinçli sapmalar (karar kayıtları)

1. **Claude API değil, Gemini Flash (direct).** v2/v3 tüm AI'ı Claude üzerine
   kurguluyordu. Uygulama `gemini-flash-latest` + AI SDK v6 (`@ai-sdk/google`,
   Gateway'siz) ile gitti — maliyet ve tek-provider sadeliği. (15.07.2026'da
   model `gemini-3-flash-preview`'a yükseltildi; fiyat ~7-10× arttı, SKU
   sabitleri güncellendi.) Gerekçe:
   [[../04-integrations/gemini#why-direct-not-gateway]]. İkinci provider
   ihtiyacı doğarsa Gateway'e geçiş tek satır.
2. **Soft-features filtresi → LLM-as-judge.** v1.7.x'in kural-tabanlı soft
   filtresi Phase 6.5'te kaldırıldı; rank-results LLM'i tam profil payload'ı
   ile bütünsel skorluyor. `boosts`/hint-chip katmanı da kaldırıldı (v1.8.1).
3. **AI-28 (Gateway & model routing) hedefleri Gateway'siz sağlandı:** cost
   tracking (`api_usage` + AI SKU'ları), rate limit (günlük cap), observability
   (Honeycomb). Multi-provider failover bilinçli atlandı — tek provider varken
   gereksiz.
4. **Embeddings/pgvector ertelendi.** ≤200 aday üzerinde LLM-as-judge, mevcut
   ölçekte (≈500 mekan) embedding aramasından daha isabetli ve yeterince ucuz.
   Tetik: 2.000+ mekan / çok kullanıcı / rerank maliyeti sorun olursa.

## 0.3 v4'ün varsaydığı yeni temeller

v4 önerilerini v3'ten daha ucuz kılan, artık VAR olan altyapı:

- **`place_profile` pivotu, tam kapsama yakın** — kütüphanenin ~%95'i full
  profilli (backfill sonrası). Tüm downstream AI bunu okur.
  [[../05-flows/ai-enrichment-flow]]
- **İki interaktif AI route'u** (parse-query, rank-results) + user-context
  builder + prompt/schema kalıpları — yeni AI feature'lar için kopyalanabilir
  şablon.
- **Moderation queue** — herhangi bir AI önerisi için hazır human-in-the-loop.
- **Maliyet altyapısı** — SKU tracking + günlük cap + CostTracker UI.
- **Honeycomb** — her yeni AI feature'ın telemetrisi bedavaya gelir.
- **DataForSEO zengin verisi hâlâ UI'da atıl** — `rating_distribution`,
  `popular_times`, `place_topics`, `attributes`, `people_also_search`,
  `book_online_url`, `owner_answer`, review images. NF-01..06'nın hammaddesi.

## 0.4 Canlı durum (15.07.2026)

- Production **sağlıklı** — v1.14.1 canlıda. **S0 bakım paketi (v1.15.0)**
  PR'da, preview test bekliyor.
- ✅ PR #61 (dependabot) — S0'da `origin/main`'den taze yeniden uygulandı +
  build kırıkları düzeltildi; #61 **superseded** olarak kapatılacak.
- ✅ ESLint 10 kırığı düzeltildi (`settings.react.version` pin + `.claude/**`
  ignore). `npm run lint` artık çalışıyor: **0 error, 107 warning**.
- Test yok; migrations dashboard-managed. Lint teknik borcu (49 `any` + 28
  react-hooks-7 kuralı) `warn`e çekildi — bkz. PART 4 #12.

---

# PART 1 — Tam Durum Matrisi

## 1.1 ✅ Tamamlananlar (kümülatif)

| ID | Feature | Dönem |
|----|---------|-------|
| F-02 | Mekan sıralama | Nisan |
| F-06 (v2) | Dark mode & tema | Nisan |
| F-07 (v2) | Custom map markers | Nisan |
| F-09 (v2) | Drag & drop liste sıralama | Nisan |
| F-10 (v2) | Trip planner (k-means auto-plan + rotalar) | Nisan |
| F-11a | Public sharing links (liste + trip) | Nisan |
| F-14 (v2) | İstatistik dashboard | Nisan |
| — | Batch import (client-driven) + DataForSEO entegrasyonu | Nisan |
| AI-01 | Doğal dil arama (judge-mimarisiyle) | Mayıs |
| AI-03 | Akıllı kategorizasyon (lite + full + 5.5) | Mayıs |
| AI-04 | Etiket önerisi (auto-apply + queue) | Mayıs |
| AI-05 | Mekan özeti (profil + AiSummaryCard) | Mayıs |
| — | Sub-categories, moderation queue, backfill, observability, cost cap | Mayıs |

## 1.2 🟡 Kısmi

| ID | Yapılan | Eksik |
|----|---------|-------|
| **F-01** Manuel ekleme | Arama ile ekleme (Mapbox Search Box) ✅ | Haritaya **pin bırakarak** ekleme; `places.source` ayrımı |
| **AI-06** Sentiment | Tema-bazlı sentiment + kanıt alıntıları (`theme_insights`) UI'da ✅ | (a) sayısal tema skorları / bar chart, (b) **trend analizi** (zaman bazlı, "servis şikayetleri artıyor"), (c) **karşılaştırmalı sentiment** (F-04'e bağlı), (d) TR özet |
| **AI-08** Akıllı import | Import→AI kapsama boşluğu backfill paneliyle kapandı ✅ | Asıl spec: başarısız/belirsiz import'ların LLM ile kurtarılması; import sırasında inline kategorizasyon |
| **AI-28** AI altyapısı | Cost/rate/observability ✅ (Gateway'siz) | Multi-provider failover (bilinçli erteleme), A/B test |

## 1.3 🔄 Açık backlog (v4 önceliğiyle)

Öncelik: **P1** = sıradaki 1-2 sprint · **P2** = sonraki çeyrek · **P3** = tetik bekliyor.

| ID | Feature | v4 Önceliği | Not |
|----|---------|-------------|-----|
| NF-01..06 | DataForSEO görselleştirme paketi (≈ F-21 place detail v2) | **P1** | Veri DB'de hazır, API maliyeti sıfır |
| NF-19 | Bulk edit (kategori/tag/status/liste) | **P1** | Import sonrası QoL |
| F-03 / NF-20 / NF-21 | Kayıtlı filtreler + quick chips (+ "AI sorgusunu kaydet") | **P1** | AI-01 ile birleşik güçlü |
| F-04 + AI-19* | Mekan karşılaştırma + AI analiz (*v3-ai-first; ≈ v3 AI-15) | **P1** | Profiller hazır → LLM karşılaştırma neredeyse bedava; AI-06(c)'yi de kapatır |
| AI-02 | Agentic asistan / chatbot | **P2 (büyük)** | Tool'ların yarısı zaten route olarak var; bkz. PART 2 |
| AI-09 | AI trip planner | **P2 (büyük)** | Mevcut kural-tabanlı auto-plan'ın LLM üstyapısı |
| NF-07 | Multi-modal routing (walking/driving/cycling) | **P2** | Mapbox zaten destekliyor |
| NF-08 | Trip budget tracking | **P2** | |
| NF-16 | Onboarding wizard | **P2** | Çok kullanıcıya açılmadan önce şart |
| NF-18 | Tek mekan paylaşımı | **P2** | `shared_links`'e `'place'` tipi — ~1 gün |
| AI-22 (v3) | Veri kalite ajanı (cron) | **🟡 v1 kuruldu (15.07.2026)** | Günlük refresh cron canlı — [[../06-ops/runbooks/periodic-refresh]]; grandfather re-enrich + kapanmış-mekan tespiti sonraki görev tipleri |
| F-06 (v3) / NF-22 | Export & backup (CSV/JSON/GeoJSON/KML) | **P2** | Veri güveni; düşük effort |
| AI-13 (v3) | Mood-based discovery | **P3** | AI-02'nin alt senaryosu olarak daha ucuz |
| AI-07 | Recommendation engine | **P3** | `people_also_search` (NF-05) ilk adım |
| NF-12..15 | Harita yenilikleri (heatmap, layer toggle, lasso, spiderfy) | **P3** | NF-13 layer toggle en değerlisi |
| NF-09 / F-24 | Trip templates | **P3** | Çok kullanıcı senaryosu |
| F-20 / NF-23 | Offline / gelişmiş PWA | **P3** | Seyahat UX; iOS kararıyla birlikte düşün |
| F-23 | Native iOS (Expo) | **P3 (stratejik)** | Proje hedeflerinde var; ayrı karar dokümanı ister |
| F-05 / AI-28(ses) | Voice quick add | **P3** | Native app ile anlamlı |
| AI-10 (v3) | Vision (fotoğraftan mekan) | **P3** | Gemini vision ile mümkün |
| F-12 (v3) | Duplikat tespiti & merge | **P3** | pg_trgm gerekir |
| F-13 (v3) | Rich notes & user media | **P3** | |
| F-15 (v3) | Bildirimler | **P3** | Push altyapısı büyük iş |
| F-18 (v3) | Calendar entegrasyonu (iCal) | **P3** | iCal export ucuz kısmı erken alınabilir |
| F-19 (v3) | Gelişmiş istatistik / gamification | **P3** | |
| F-22 (v3) / NF-10 | Seyahat günlüğü | **P3** | |

## 1.4 ❌ Düşürülen / rafa kaldırılanlar (gerekçeli)

| ID | Feature | Gerekçe |
|----|---------|---------|
| F-11 | Collaborative lists & trips | v2'den beri rafta — RLS karmaşıklığı yüksek, uygulama bugün fiilen tek kullanıcılı. Tetik: gerçek çok-kullanıcı talebi. |
| F-17 (v3) | Sosyal keşif & feed | Aynı tetik. Solo uygulamada feed anlamsız. |
| F-25 (v3) | Premium subscription | Monetizasyon için önce kullanıcı tabanı. AI maliyeti şu an ~$2-5/ay — baskı yok (cap var). |
| F-16 (v3) | i18n | Tek kullanıcı TR/EN bilingual; büyüme tetiği bekliyor. |
| AI-07 Seviye 2 | Embeddings/pgvector | Bkz. 0.2 madde 4. |
| AI-20/25/26 (v3) | Sosyal içerik üretici, dil asistanı, trend raporu | Nice-to-have; taşıyıcı feature'ları (F-17, seyahat) beklemeli. |
| AI-16 (v3) | Real-time rota optimizasyonu | Trip planner kullanım sıklığı henüz bunu doğrulamıyor. |

---

# PART 2 — v4 Öncelikli Backlog (kürasyon)

Altı tema. Her tema kendi içinde sıralı; temalar arası sıra PART 3'te.

## Tema 1 — "Eldeki veriyi göster" (NF-01..06 ≈ place detail v2)

**Neden şimdi:** DataForSEO verisi aylardır DB'de atıl. Sıfır API maliyeti,
sıfır AI maliyeti, tamamı UI işi. Detay sayfası "Google Maps alternatifi"
hissine en ucuz yoldan bu paketle ulaşır. Ayrıntılı spec'ler:
`_archive/feature-suggestions_v3-ai-first.md` NF-01..NF-06 (aynen geçerli).

| Sıra | ID | İş | Effort |
|------|----|----|--------|
| 1 | NF-01 | Rating distribution bar chart (CSS-only yeterli) | 1g |
| 2 | NF-03 | Place topics tag cloud (+ topic'e tıkla → review filtrele) | 0.5-1g |
| 3 | NF-04 | Attributes grid + `current_status`/`is_claimed` badge'leri | 2-3g |
| 4 | NF-06 | Action buttons (rezervasyon/menü/sipariş) + owner answer + review images | 2-3g |
| 5 | NF-02 | Popular times widget (gün seçici + yoğunluk barları) | 1-2g |
| 6 | NF-05 | "Similar places" chips (`people_also_search` → CID ile ekleme akışı) | 2-3g |

**Paket toplamı ~8-13 gün.** NF-04'ün filtre bacağı (attribute filtresi)
ayrılıp sonraya bırakılabilir (UI önce).

## Tema 2 — "Profil varlığını işlet" (karşılaştırma + AI-06 kapanışı)

**Neden şimdi:** 450+ mekanın full profili var; onları okuyan ikinci feature
hâlâ yok (ilki AI arama). Karşılaştırma, profillerin en doğal ikinci müşterisi.

- **F-04 — Karşılaştırma UI** (2-4 mekan, side-by-side): bulk-select altyapısı
  (`selectedPlaceIds`) hazır; `/places/compare?ids=…`. Kolonlar: rating +
  distribution, fiyat, mesafe, `theme_insights` tema satırları, pros/cons.
  *Effort: 3-4g*
- **AI karşılaştırma analizi** (v3 AI-15 / ai-first AI-19): seçili mekanların
  profillerini Gemini'ye ver → tema bazlı kazanan + nüanslı öneri
  (`"özel akşam için A, günlük yemek için B"`). Profiller hazır olduğundan
  input maliyeti düşük (~$0.002/karşılaştırma). Mevcut parse-query route
  şablonuyla `POST /api/ai/compare`. *Effort: 2-3g*
- **AI-06 trend bacağı**: review'lar tarihli — profile
  `theme_trends` alanı eklenerek re-profile'da hesaplanabilir ("son 3 ayda
  servis mention'ları negatifleşti"). Model-version bump + seçici re-profile
  gerektirir; PART 4'teki re-profile mekanizmasıyla birlikte yapılmalı.
  *Effort: 2-3g (re-profile altyapısı hariç)*

## Tema 3 — "Asistan" (AI-02)

**Neden artık gerçekçi:** v3 bunu 8-12 gün fiyatlamıştı. Bugün maliyetin
büyük kısmı hazır: `search_places` = mevcut `/api/places` + parse-query;
`get_place_details`, `compare_places` (Tema 2 ile), `add_to_list`,
`get_stats` — hepsi mevcut route'ların tool-wrap'i. Kalan gerçek iş: chat UI
(`useChat`), agent loop (`stopWhen: stepCountIs(n)`), action confirmation
UX'i ve (v2'de) session-only memory. **Effort artık ~5-7g.**

Karar noktaları:
- Model: Gemini Flash yeterli mi, yoksa tool-use kalitesi için ikinci provider
  (Gateway'e geçiş tetiği) gerekir mi? İlk sürüm Flash ile denenmeli.
- Kalıcı memory (v3 AI-23) v1'e girmez — session memory yeter.
- Cap: chat turları `ai_parse_query`'den ayrı SKU almalı (`ai_chat`).

## Tema 4 — "Trip intelligence" (AI-09 v1 + NF-07/08)

- **AI-09 v1**: mevcut k-means auto-plan'ı LLM ile değiştirmek yerine
  **augment et**: kullanıcı "3 günlük İstanbul" der → LLM kayıtlı want_to_go
  mekanları + profilleri okur → tema/saat mantıklı gün dağılımı + gerekçe.
  Çıktı mevcut trip entity'sine yazılır (yeni tablo yok). *Effort: 5-8g*
- **NF-07 Multi-modal routing**: `trip_days.routing_profile` + Directions
  profile parametresi. *Effort: 1-2g*
- **NF-08 Budget**: `cost_estimate` kolonları + `price_level` default'ları.
  *Effort: 3-4g*

## Tema 5 — "Power-user QoL"

- **NF-19 Bulk edit** (`PATCH /api/places/bulk`): kategori/tag/status/liste.
  *2-3g*
- **F-03 + NF-20/21 Kayıtlı filtreler + quick chips**: `saved_filters`
  tablosu; **"bu AI sorgusunu kaydet"** entegrasyonu (AI-01 çıktısı filtre
  seti olarak zaten URL'de). *2-3g*
- **NF-18 Tek mekan paylaşımı**: `shared_links.resource_type += 'place'`.
  *1g*

## Tema 6 — "Ops & veri sağlığı" (sürekli iş)

- **AI-22 Veri kalite ajanı** (Vercel Cron): eksik profil / stale veri /
  kapanmış mekan (`current_status`) taraması. **İlk görev tipi olarak
  [[backfill-grandfather-reenrich]] fix'ini içerir** (re-enrich thin
  profiles) — ertelenen plan böylece doğal sahibini bulur. *5-7g*
- **Model-version re-profile mekanizması**: `model_version != current` seçici
  yeniden üretim (gemini.md open question). AI-06 trend bacağının ön koşulu.
  *2-3g*
- **Mini eval seti**: 15-20 altın-standart sorgu → parse-query + rank-results
  regresyon testi (prompt değişikliklerinde koşulur). *1-2g*

---

# PART 3 — Önerilen Sprint Planı

| Sprint | İçerik | Süre | Çıktı |
|--------|--------|------|-------|
| **S0 — Bakım** ✅ | PR #61 (superseded) + ESLint 10 fix + legacy `/api/places/import` kaldırıldı (v1.15.0) | 1-2g | ✅ Yeşil CI, temiz lint (0 error) |
| **S1 — Veriyi Göster** | Tema 1 (NF-01→06) | ~2 hafta | Place detail v2 |
| **S2 — Karşılaştır & Kaydet** | Tema 2 (F-04 + AI compare) + Tema 5 (bulk edit, saved filters, place share) | ~2 hafta | Profilleri işleten 2. feature + QoL paketi |
| **S3 — Asistan** | Tema 3 (AI-02 v1, session-memory) | ~1.5-2 hafta | Chat ile mekan keşfi/aksiyonu |
| **S4 — Trip Intelligence** | Tema 4 (AI-09 v1 + NF-07/08) | ~2 hafta | LLM destekli trip planlama |
| **S5 — Growth & Platform kararı** | NF-16 onboarding + NF-09 templates; **F-23 iOS go/no-go karar dokümanı** | ~2 hafta | Çok-kullanıcıya hazırlık |
| **Sürekli** | Tema 6 (S2'den itibaren paralel: kalite ajanı, re-profile, eval) | — | Veri sağlığı |

Effort/impact özeti (v3 matrisinin v4 revizyonu — sadece P1/P2):

```
                     IMPACT
            Orta                Yüksek
  Düşük   NF-01 NF-03 NF-18   NF-02 NF-07 (S0 bakım)
  (≤2g)   NF-20                F-03+kaydet
  Orta    NF-04 NF-05 NF-08   NF-06 NF-19 F-04+AI-compare
  (2-5g)  eval                 NF-16 AI-22
  Yüksek                       AI-02  AI-09  (F-23 iOS: ayrı karar)
  (5g+)
```

---

# PART 4 — Teknik Borç & Bakım

| # | Konu | Durum | Aksiyon |
|---|------|-------|---------|
| 1 | **PR #61** — dependabot 21 paket, preview build FAIL (04.07) | ✅ çözüldü (v1.15.0) | Taze yeniden uygulandı; kıran neden `@types/geojson`'un transitive düşmesi + `@opentelemetry/sdk-logs` 0.220 `BatchLogRecordProcessor` API değişikliğiydi. #61 superseded kapatılacak |
| 2 | **ESLint kırık** — ESLint 10 × `eslint-plugin-react@7.37.5` (`context.getFilename()` ESLint 10'da kaldırıldı) | ✅ çözüldü (v1.15.0) | `settings.react.version` pin (detection atlanıyor) + `.claude/**` ignore |
| 3 | **Test yok** | 🟠 | En azından Tema 6 eval seti + kritik API route'lara smoke test |
| 4 | **Grandfather thin profiles** | 🟡 ertelendi | Plan hazır: [[backfill-grandfather-reenrich]]; AI-22 ajanının ilk görevi yap |
| 5 | **Legacy `/api/places/import`** | ✅ kaldırıldı (v1.15.0) | Referansı yoktu; `import-parse` + `import-batch` aktif akış |
| 6 | **`SECURITY DEFINER` fonksiyonlar anon'a açık** (advisor) | 🟡 | `handle_new_user`, `increment_api_usage` vb. — grant'leri daralt |
| 7 | **Migrations dashboard-managed** — repo'da migration klasörü yok | 🟡 | Kabul edilmiş durum; en azından şema snapshot'ını vault'ta güncel tut |
| 8 | **Model snapshot takibi** — 15.07.2026'da `gemini-3-flash-preview`'a geçildi (GA olunca id değişebilir); eski `gemini-flash-latest` damgalı profiller ilk re-profile kohortu | 🟡 | Tema 6 re-profile mekanizması |
| 9 | **Back-to-back AI arama trace race** | 🟢 kabul | Ertelendi (v1.10.0) — tek kullanıcıda pratik etkisi yok |
| 10 | **`api_usage` retention** | 🟢 | Yıllık ~yüzlerce satır/kullanıcı — şimdilik sorun değil |
| 11 | **Review'lar tek seferlik** — refresh sonrası profil yenilenmiyor (manuel akış) | 🟡 | `refresh-google-data` → profile chain (grandfather planının 1. maddesi) |
| 12 | **Lint teknik borcu** — 49 `@typescript-eslint/no-explicit-any` (eskiden ESLint crash'inin ardında gizliydi) + 28 `react-hooks/*` (eslint-plugin-react-hooks@7 React-Compiler kuralları: `set-state-in-effect`, `preserve-manual-memoization`, `refs`, `use-memo`, `purity`) | 🟡 `warn`e çekildi (v1.15.0) | Kademeli tüket; **yeni kod bu kurallara error gibi uymalı**. Downgrade `eslint.config.mjs` rules bloğunda, geri açılacak |

---

# PART 5 — Ekler

## 5.1 v3-ai-first `AI-xx` ↔ kanonik (v3) eşleştirme

v3-ai-first kendi AI numaralarını kullandı; karışıklığı önlemek için eşleştirme:

| v3-ai-first | Konu | Kanonik karşılık |
|-------------|------|------------------|
| AI-01, AI-02 | NL arama, chatbot | AI-01, AI-02 (aynı) |
| AI-03, AI-28 | Voice mode / voice notes | F-05 (voice) altında |
| AI-04 | Conversational trip editor | AI-09'un alt özelliği |
| AI-05, AI-06 | Kategorizasyon, etiket | AI-03, AI-04 (aynı konu) |
| AI-07 | Import enrichment | AI-08 |
| AI-08 | AI duplicate detection | F-12'nin AI bacağı |
| AI-09 | Bulk re-categorization | AI-22 ajanının görev tipi |
| AI-10, AI-12 | Özet, sentiment | AI-05, AI-06 |
| AI-11 | Note polishing | F-13 ile |
| AI-13 | Review translation | AI-06(d) / i18n |
| AI-14, AI-15 | Share caption, trip story | AI-20, AI-12 (v3) — rafta |
| AI-16..18 | Recommendations, web-discovery, mood | AI-07, AI-24, AI-13 (v3) |
| AI-19 | AI karşılaştırma | v3 AI-15 — **v4 Tema 2** |
| AI-20..25 | Trip intelligence ailesi | AI-09 + AI-16/17/18 (v3) |
| AI-26, AI-27, AI-29, AI-30 | Vision ailesi | AI-10 (v3) + niş türevleri |
| AI-31..34 | Personality, recall, lifecycle, year-in-review | AI-23/26 (v3) — P3 |
| AI-35..38 | Search suggestions, anomaly, notif timing, tag cleanup | AI-22/24 (v3) türevleri — P3 |

## 5.2 Karar kayıtları (özet)

| Karar | Tarih | Nerede |
|-------|-------|--------|
| Gemini Flash direct (Gateway yok) | Mayıs 2026 | [[../04-integrations/gemini]] |
| Soft-features → LLM-as-judge | 19.05.2026 | [[phase-6-llm-as-judge-pivot]] |
| Embeddings ertelendi | Mayıs 2026 | Bu doküman 0.2 |
| Collaborative (F-11) rafta | v2'den beri | v2 PART 5 |
| Grandfather re-enrich ertelendi | 20.05.2026 | [[backfill-grandfather-reenrich]] |
| Günlük AI cap = 3000 | 20.05.2026 | [[../05-flows/ai-enrichment-flow#cost-cap]] |
| AI bütçeleri: arama 500/ay (arama başına 1 birim) + profil 1000/ay | 15.07.2026 | [[../05-flows/ai-enrichment-flow#cost-cap]] |
| Cron sweep: kullanıcı başına TÜMÜYLE opt-in (default kapalı) + re-profile için >15 yeni yorum eşiği; omurga tazeleme Oca/Tem | 15.07.2026 | [[../06-ops/runbooks/periodic-refresh]] |
| S0: PR #61 taze yeniden uygulandı (bayat dal), superseded kapatılır | 15.07.2026 | Bu doküman PART 4 #1 |
| S0: yeni strict lint kuralları (any + react-hooks-7) `warn` — kademeli adopte | 15.07.2026 | Bu doküman PART 4 #12 |

## 5.3 Bu dokümanın bakımı

- Bir feature başladığında: ilgili satırı 🟡'ya çek, `_plans/`'a faz dokümanı aç.
- Bir sprint bittiğinde: PART 0-1 tablolarını güncelle, `version` minor bump.
- v5 tetiği: bu backlog'un P1+P2'si biterse veya strateji değişirse (iOS kararı gibi).
