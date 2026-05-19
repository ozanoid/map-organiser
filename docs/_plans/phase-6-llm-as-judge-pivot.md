---
title: "Phase 6.5 — LLM-as-judge pivot (design doc)"
type: plan
domain: ai
version: 1.0.0
last_updated: 19.05.2026
status: in-progress
related:
  - "[[phase-6-nl-filtering]]"
  - "[[../05-flows/ai-search-flow]]"
  - "[[../04-integrations/gemini]]"
---

# Phase 6.5 — LLM-as-judge pivot

> Phase 6 v1.7.4'te uzunca tartıştığımız, sonra mimari pivot olarak kararlaştırdığımız değişikliklerin design doc'u. PR shipping'i sırasında bu doc bizim referans noktamız.

## Sebep — neden pivot

Phase 6 v1.7.x'te şu mimari problemleri canlı testte ortaya çıktı:

1. **Vocab mismatch** — parse-query LLM "date_night" snake_case emit ediyor, Phase 4 LLM "Date night" Title Case + space üretiyor. String compare match etmiyor. Çoğu yer kaçırılıyor.

2. **Synonym blindness** — "Romantic" (13 yer), "Intimate" (14), "moody" (2), "dimly-lit" (2) → semantically aynı, string olarak farklı. Canonicalization sadece formatı çözer, synonyms hâlâ kaçar.

3. **Eksik dimensions** — Phase 4 9 axis üretiyor (atmosphere, occasions, dietary, seating, cuisine_types, music, crowd, price_range, distinctive), parse-query sadece 5'ini kullanıyor. Plus `theme_insights`, `tldr`, `pros`, `cons` hiç tüketilmiyor.

4. **Statik filter LLM-üretimi-data üzerinde fragile** — LLM'in zengin doğal dil çıktısını canonical vocab'a sıkıştırıp string match yapmaya çalışmak temel olarak fighting against LLM strengths.

**Kullanıcının teşhisi:** _"LLM'in ürettiği datayı kısıtlayarak onun üzerine statik rule-based filter kurmaya çalışıyorsun. Bunun yerine LLM'in seçim yapmasını sağlayacak bir sistem geliştirelim."_

## Yeni mimari — özet

```
parse-query (Gemini #1)
  ├─ hard filter: SADECE structural axisler
  ├─ semantic_intent: tek rich string (tüm soft niyet)
  ├─ boosts.matching_*_ids: SADECE UI hint chips için
  └─ requires_semantic_ranking: token consumption check

/api/places
  ├─ Sadece HARD filter SQL
  ├─ Soft filter KALDIRILDI
  └─ AI search aktifken sort = google_rating DESC

Adaptive cap (TOP_N selection):
  ≤ 100 result  → hepsi rerank'e
  101-300       → top 100 by google_rating DESC
  > 300         → 200 hard cap

Rerank (Gemini #2) — sadece requires_semantic_ranking=true ise
  ├─ Per-candidate BOL PAYLOAD:
  │    name + searchable_summary + features (9 axis) +
  │    theme_insights + tldr + pros + cons
  ├─ LLM 6-tier rubric ile skor + why
  ├─ LLM'in hide power'ı var: < 0.20 = should not surface
  └─ BOOST POST-PROCESS YOK (kaldırıldı)

UI:
  ├─ HIDE < 0.20 (markers + cards her ikisinde)
  ├─ Sort dropdown disabled when AI active
  ├─ Hint chips: opt-in narrowing (boosts.matching_*_ids'den)
  ├─ Banner: broaden mode toggle (narrow vs broader)
  └─ Why line: only when ranking exists
```

## 7 Karar — finalize edilmiş

### Karar 1 — Hard filter scope = **Option A (minimal)**

**10 hard axis:** category, city, country, visit_status, rating_min, google_rating_min, created_after, explicit subcategory_ids, explicit tag_ids, explicit list_id.

Geri kalan her şey (dietary, cuisine_types, seating, atmosphere, occasions, music, crowd, price_range, distinctive, theme_insights, tldr, pros, cons, searchable_summary) → **LLM-judge in rank-results**.

### Karar 1a — `soft_features` kaldırılır

`ParseQuerySchema.soft_features` ve `PlaceFilters.soft_features` tamamen silinir. `/api/places` artık `f_*` URL params'ı tanımaz.

### Karar 1b — Yerine **single rich `semantic_intent`** string

Eski terse restatement'ın yerine, parse-query LLM zengin bir narrative üretir:

```
intent: "London restaurants suitable for a date.
         User wants: romantic, intimate atmosphere;
         possibly candlelit or dimly-lit settings;
         occasion fit: date night or special occasion;
         service quality matters; avoid loud sports-bar atmosphere."
```

Rank-results LLM bunu kullanarak her aday için holistic değerlendirme yapar.

### Karar 1c — Context'te hard data prensibi

Hard filter olarak tanımlanan her axis'in kullanıcı evrenindeki MEVCUT değerleri context'te gösterilmeli (LLM bunu rastgele icat etmesin). Option A'da yeni aggregate gerekmiyor — mevcut context (categories, cities by country, tags, lists) yeterli.

### Karar 2 — `requires_semantic_ranking` rule = **Token consumption check**

LLM her distinguishing token'ın hard filter'da consumed olup olmadığını kontrol eder:

```
- Filler words (my, the, all, show, find, places, ones) → görmezden gel
- Distinguishing tokens için her birinin hard.* field'larında karşılığı var mı?
- HEPSI consumed → requires_semantic_ranking = false
- AT LEAST ONE unconsumed → requires_semantic_ranking = true
```

Örnek:
- `"all my cafes"` → cafes consumed by hard.category → **false**
- `"all my vegan restaurants"` → vegan unconsumed (dietary LLM-judge) → **true**
- `"fine dining in london"` → all consumed → **false**
- `"best date restaurants in london"` → best+date unconsumed → **true**

### Karar 3 — TOP_N + sort + payload

**Adaptive cap:**
- `≤ 100` candidates → tümü rerank'e
- `101-300` → google_rating DESC ile top 100
- `> 300` → 200 hard cap (cost guard)

**Sort override:** AI search aktifken `/api/places` her zaman `google_rating DESC` döner. Kullanıcının sort tercihi UI'da disabled.

**Pure listing (rerank false) sort:** `google_rating DESC` (newest yerine — quality öncelik).

**Bol payload per candidate:**
```ts
{
  id, name,
  searchable_summary,
  features: {
    atmosphere, occasions, dietary, seating, cuisine_types,
    music, crowd, price_range, distinctive
  },
  theme_insights: [...],
  tldr, pros, cons
}
```

~1200 char/candidate. TOP_N=50 için ~60K input tokens. Cost: ~$0.005/rerank. F&F scope için cap yok.

### Karar 4 — UI threshold + display

**Threshold = 0.20.**

**HIDE < threshold** (fade DEĞİL). UI'da görünmez. Marker map'te yok. Card grid'de yok.

**6-tier scoring rubric** rank-results prompt'ta:
- 0.85-1.00 EXCELLENT — top result, always show, confident
- 0.65-0.85 GOOD — show with confidence
- 0.45-0.65 DECENT — show, mid-tier
- 0.25-0.45 MARGINAL — show at bottom, low confidence
- 0.10-0.25 WEAK — borderline, may be hidden
- 0.00-0.10 IRRELEVANT — HIDE, should not surface

**LLM has "hide power":** prompt'a açıkça yazılır — "anything you score below 0.20 will be hidden from user. Use this deliberately to keep results clean. McDonald's for 'date restaurants' → score 0.05 (HIDE)."

**Answer engine framing:** kullanıcı sorar, sistem temiz cevap verir, gereksizler gizlenir.

**Marker popup'a why YOK** — sidebar zaten gösteriyor, tekrardan kaçın.

### Karar 5 — Adaptive broaden with banner toggle

Hard filter sonucu **< 10** ise:

1. Restricted explicit hard filter'lardan (subcategory_ids, tag_ids, list_id) en kısıtlayıcısı drop edilir
2. Yeniden sorgu çalışır — broader set döner
3. UI banner gösterir:
   ```
   Found 3 fine-dining places. Showing 28 broader matches.
   [Show only fine-dining (3)]  [Keep broader (28) ←active]
   ```
4. semantic_intent'e bilgi eklenir: "User originally requested X, broadened to include similar."
5. Kullanıcı toggle ile narrow ↔ broader switch yapabilir.

Drop edilmeyenler: category, city, country, visit_status, rating_min — bunlar **her zaman** korunur.

### Karar 6 — Boost mechanism TAMAMEN kaldırılır

**Kaldırılan:**
- Rank-results route'da `boost_*_ids` body params
- Server-side boost post-process (+0.15 score bump)
- Sub-cat boost, tag boost, list boost lookup queries

**Korunan (hint chips için):**
- Parse-query schema'da `boosts.matching_*_ids` field
- Sanitization (UUID validation against user context)
- AISearchInput hint chips UI ("you have curated items that may match")
- Click → hard filter olarak uygulanır (opt-in narrowing)

**Felsefe:** LLM-judge zaten profile'da features.* + searchable_summary okur. User curation hint chips ile **opt-in görünür**, scoring'e müdahale etmez.

### Karar 7 — Big bang migration + graceful URL degradation

**Strateji:** Tek PR, atomik deploy. Versioning / deprecation period yok.

**Codebase:**
- Eski `soft_features` kodu **tamamen silinir** (schema, route, hook, type, UI)
- `canonFeature` helper unused → silinir
- `LESS_RELEVANT_SCORE` 0.15 → 0.20

**URL state — graceful degradation:**
- Eski bookmark'lar: `?city=London&f_atmosphere=cozy&f_occasions=date_night`
- Yeni client `f_*` params'ı görür, silently ignore eder
- Sadece structural filters apply olur
- Hata yok, sadece soft filter kaybolur

**DB:** Migration gerekmez. `place_profile.features.*` veri olduğu gibi rank-results tarafından tüketilir.

**Active session window:** Vercel atomic deploy. Old client + new server window 5-10s. F&F scope için acceptable.

**Revert:** `git revert` + redeploy. Schema/code level reversible.

## Mode-based UI behavior

```
┌─────────────────────────────────────────────────────────┐
│ NORMAL MODE — rankings === null                          │
│                                                          │
│ /places:  Cards with address line, sort dropdown active │
│ /map:     All markers, sidebar lists name+address       │
│ Sort:     User picks (newest/oldest/name/rating)        │
│ Filters:  Standard category/city/tag UI                 │
└─────────────────────────────────────────────────────────┘
                       │
            User submits AI search query
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ AI ACTIVE MODE — rankings populated                      │
│                                                          │
│ /places:  Cards with WHY line (no address),             │
│           sort dropdown DISABLED,                        │
│           cards with score < 0.20 HIDDEN                 │
│ /map:     Markers with score < 0.20 HIDDEN,              │
│           sidebar dropdown sorted by score, why line,    │
│           NO popup why (intentional)                     │
│ Sort:     "AI Ranked" badge, disabled                    │
│ Banner:   If broadened: toggle narrow/broader            │
│ Chips:    Hint chips for opt-in narrowing                │
└─────────────────────────────────────────────────────────┘
                       │
              User clears AI search (X button)
                       │
                       ▼
                  NORMAL MODE
```

**Mode flag:** `useAiSearchStore.rankings !== null`. Tüm AI features bu condition'a bağlı render edilir.

`/lists/[id]` page: AI search yok — kullanıcı zaten listeyi seçmiş, AI'a gerek yok.

## Surface-by-surface UX

### `/map`

| Element | Normal | AI Active |
|---|---|---|
| Markers | All matching | < 0.20 hidden |
| Sidebar "N places" dropdown | Name + address | Sorted by score, why line |
| Marker popup | Standard | Same (no why) |
| Filter sidebar | Standard | + applied chips + banner |

### `/places`

| Element | Normal | AI Active |
|---|---|---|
| Card grid | Standard cards | Sorted by score, < 0.20 hidden, why line |
| Sort dropdown | Active | DISABLED, "AI Ranked" badge |
| Banner | none | If broadened: toggle |
| Filter sidebar | Standard | + applied chips + banner |

### `/lists/[id]`

AI search: **YOK**. Standard list view.

## Implementation slice plan

Tek branch (`feat/llm-as-judge-pivot`), tek PR. Commit slice'ları:

1. **refactor(types)** — `PlaceFilters.soft_features` field kaldırılır
2. **refactor(ai-schema)** — `ParseQuerySchema.soft_features` field kaldırılır
3. **refactor(prompts)** — `parse-query.ts` yeniden yazılır (single intent, token rule, answer engine framing)
4. **refactor(places)** — `/api/places` route'tan soft filter + f_* parsing kaldırılır, sort override aktif edilir
5. **feat(broaden)** — Adaptive broaden logic in useAiSearch + ai-search-store
6. **refactor(rank-results)** — Full payload prompt, 6-tier rubric, boost post-process kaldırılır
7. **refactor(places-page)** — SelectablePlaceCard composition with PlaceCard
8. **feat(ui-mode)** — Hide < threshold + sort disable + banner toggle
9. **refactor(map)** — Markers filter + sidebar sort + popup unchanged
10. **docs** — `ai-search-flow.md` yeniden yazılır, gemini.md cost update, CHANGELOG v1.8.0

## Açık implementation detayları

- **Broaden orchestration location:** client-side (useAiSearch hook). Server-side count + retry yerine, useAiSearch hard filter sonucu görür, threshold altı ise broader filter ile re-fetch.
- **Mode flag detection:** `rankings !== null` veya `lastQuery !== null`. Tutarlılık için `rankings` kullanılır.
- **canonFeature helper:** Soft filter silinince unused. Helper de silinir.
- **city OR-match (city ilike + address ilike):** PR #41'in fix'i hâlâ valid. Korunur.
- **gemini-flash-latest:** Model değişmez. (User Karar)

## Acceptance criteria

- [ ] Normal browsing UX `/map` ve `/places`'te değişmedi (kullanıcı AI search'e dokunmadıysa)
- [ ] AI search aktif olunca `/map`: sidebar dropdown skor sırasında, markers < 0.20 yok
- [ ] AI search aktif olunca `/places`: cards skor sırasında, < 0.20 yok, sort disabled
- [ ] `"restaurants for dating in london"` sorgusunda Bambi gibi profile-rich yerler ÜST'te
- [ ] `"all my vegan restaurants"` → requires_semantic_ranking = true (vegan unconsumed)
- [ ] `"fine dining in london"` 3 sonuç dönerse banner ile broader 28 göster
- [ ] Hint chips kalıyor — click → hard filter
- [ ] Boost post-process'i hiçbir yerde yok
- [ ] Eski URL `?f_atmosphere=cozy` graceful ignore
- [ ] tsc + lint clean
- [ ] Vault sync (ai-search-flow.md v2.0, CHANGELOG v1.8.0)
