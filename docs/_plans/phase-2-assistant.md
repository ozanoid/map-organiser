---
title: "Faz 2 — Platform asistanı Claude'a: tasarım"
type: plan
domain: ai
version: 1.0.0
last_updated: 23.11.2026
status: stable
related:
  - "[[personal-assistant]]"
  - "[[phase-1-planning]]"
  - "[[../05-flows/ai-chat-flow]]"
  - "[[../04-integrations/claude-mcp]]"
  - "[[../04-integrations/gemini]]"
  - "[[../02-backend/schema/api_usage]]"
---

# Faz 2 — Platform asistanı Claude'a: tasarım

> **Onaylandı (Ozan, 23.11.2026):** aşağıdaki altı karar önerildiği gibi. [[personal-assistant]] planının Faz 2'si. Şema SQL'i uygulanmadan önce ayrıca gösterilir.

## Ne anladım

- Faz 2 "uygulama içi sohbetin modelini değiştirmek" değil, **sunucu tarafında ortak bir Claude ajanı** kurmaktır. claude.ai'ın kullandığı araç katmanını (`src/lib/assistant/tools`, 16 araç) Claude API üzerinden platformun kendisi de kullanır.
- İlk kapı uygulama içi asistan paneli. Sonraki fazlar aynı çekirdeği kullanır: Telegram sohbeti (Faz 3), plan sonrası e-postaya verilen cevaplar (Faz 4), haftalık keşif ajanı (Faz 6).
- Gemini'nin diğer işleri (Instagram okuma, mekan profili, sıralama, AI Plan) yerinde kalır.

## Kararlar (Ozan, 23.11.2026)

| # | Konu | Karar |
|---|---|---|
| 1 | Sıra | Faz 2 şimdi, "ortak ajan çekirdeği + ilk kapı uygulama içi sohbet" olarak. |
| 2 | Sohbet geçmişi | Sunucuda kalıcı, yalnız sona eklenir (aşağıda neden). |
| 3 | Yazma onayı | Uygulamada onay kartı: yazan bir araç, kullanıcı karttan onaylamadan çalışmaz. |
| 4 | Model ve effort | Ücretli eval ile seçilir (Opus 5.5 ve Sonnet 5.5, iki-üç effort seviyesi; tahmini $3–7, ölçülmedi). |
| 5 | Web araması | Açık; tur başına en fazla 3 arama. |
| 6 | Bütçe | Dolar bazında, platform geneli aylık $100; her API çağrısı bir harcama defterine yazılır. Gemini sayaçları değişmez. |

## Bugünkü durum (kanıtla)

- **Kullanım:** `api_usage`'ta `ai_chat` Temmuz 2026'da 17, Ağustos'ta 3 tur; Eylül'den beri 0 (ölçüldü 20.11.2026). Asistan bugün pratikte claude.ai üzerinden, connector'la kullanılıyor.
- **Ayrı araç seti:** uygulama içi asistan Gemini'yle ve kendi 8 aracıyla çalışıyor (`src/lib/ai/chat-tools.ts`: `search_places`, `rank_places`, `get_place_details`, `compare_places`, `get_stats`, `add_to_list`, `create_list`, `set_visit_status`). Ortak katmanda 16 araç var (`src/lib/assistant/tools/index.ts:20`). Planlar, ziyaretler, mekan ekleme ve Google Maps araması uygulama içinde yok; aynı iş iki yerde yazılı.
- **Davranış tarifi tek yerde değil:** claude.ai'ın talimatı `src/lib/assistant/mcp.ts:15`'te (`INSTRUCTIONS`), uygulama içinin talimatı `src/lib/ai/prompts/chat.ts`'te.
- **Geçmişi değiştiren üç yer** — Claude 5.5 ile çalışmayı engelliyor (aşağıda):
  - sistem talimatı her istekte yeniden kuruluyor: bugünün tarihi (`prompts/chat.ts:25`) ve kütüphane özeti (`route.ts:134`, `:154`);
  - geçmiş tarayıcıda tutulup her istekte geri gönderiliyor;
  - son 30 mesaja kırpılıyor (`route.ts:52`, `:100`).
- **Bütçe sayı bazında:** tur başına bir birim (`checkAiBudget("chat")`, `route.ts:122`); dolar karşılığı yok.

### Neden geçmiş sunucuda ve değişmez olmalı

Claude 5.5 modellerinde (Opus, Sonnet, Haiku) düşünme her zaman açık. Her düşünme bloğu onu üreten sohbetin tam önceki halini imzasıyla taşır: sistem talimatı, araç seti ve önceki her mesaj. Sohbet geri gönderildiğinde API bunu yeniden hesaplar. Önceki bir tur değişmişse — kırpılmış, yeniden yazılmış, tarayıcının mesaj biçiminden geçip bir şey kaybetmiş — o noktadan sonraki akıl yürütme düşer ya da istek reddedilir (Anthropic'in kuralına göre 31.08.2026'dan sonra açılmış hesaplarda varsayılan olarak 400). Anthropic'in önerisi bütün hesaplar için aynı: geçmiş yalnız sona eklensin. Gündelik dille: asistanın önceki düşüncesi "o sohbetin o haline" bağlı. Sohbeti ortadan değiştirirsek asistan o düşünceyi kaybeder. Bu yüzden geçmişin tek ve değişmez kopyası sunucuda durur; tarayıcı yalnız yeni mesajı gönderir.

## Model

### Varlıklar

- **Sohbet** (`assistant_conversations`) — bir kapıdan (bugün yalnız `app`) bir kullanıcının Claude'la tek konuşması. Modeli, sistem talimatı ve araç tanımları sohbet başında sabitlenir ve bir daha değişmez. Kod sonradan değişse de eski sohbet ilk gönderdiği tanımlarla devam eder; düşünme blokları da modele bağlı olduğundan model sohbet ortasında değişmez.
- **Mesaj** (`assistant_messages`) — sohbetin sırayla eklenen turları; içerik, API'ye gönderildiği ya da ondan geldiği haliyle JSON metni olarak, düşünme bloklarının imzalarıyla birlikte. Güncelleme ve silme yok; yalnız sohbetin tamamı silinebilir.
- **Harcama** (`assistant_spend`) — her Claude API çağrısının token'ları (giriş, çıkış, önbelleğe yazma ve okuma), web araması sayısı ve o anki fiyatla hesaplanmış dolar tutarı. Fiyat zamanla değişebileceği için tutar yazıldığı anda saklanır. Aylık tavan bu tablonun toplamıdır.

Değişen bilgi talimatı değiştirmez. Bugünün tarihi ve saat dilimi her yeni kullanıcı mesajına kısa bir bağlam satırı olarak eklenir. Kütüphanenin güncel hali araçtan okunur (`get_library_overview`).

### Şema

SQL: `supabase/migrations/<sürüm>_assistant_conversations.sql` — uygulanmadan önce Ozan'a gösterilir. Özet:

- `assistant_conversations (id, user_id, door, model, system_prompt, tools, created_at, updated_at)`. `door` şimdilik yalnız `'app'`; Telegram gibi yeni kapılar bir migration'la eklenir. `tools` ilk gönderilen araç dizisinin JSON metni.
- `assistant_messages (conversation_id, seq, role, content, created_at)`, birincil anahtar `(conversation_id, seq)`; `content` metin (JSON). `jsonb` değil: `jsonb` anahtar sırasını değiştirir, bu da geri gönderilen geçmişi "değişmiş" yapabilir.
- `assistant_spend (id, user_id, conversation_id, purpose, model, request_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, web_searches, cost_usd, created_at)`. `purpose`: `'chat'` | `'eval'`. Sohbet silinirse harcama kaydı kalır (`on delete set null`).
- RLS: sahibi kendi sohbet ve mesajlarını okur; sohbet açar; mesaj ekler (güncelleme ve silme izni yok); sohbetini silebilir. Harcamayı yalnız sunucu yazar (service role), sahibi okur. Mesaj eklenince sohbetin `updated_at`'ini bir tetikleyici günceller.

## Ajan çekirdeği (`src/lib/agent/`)

- **SDK:** resmi `@anthropic-ai/sdk`, akışlı yanıt. Döngü elle yazılır (SDK'nın Tool Runner'ı yerine), çünkü:
  - yazma onayı sonraki bir HTTP isteğinde gelir — döngü, yazan bir aracın çağrıldığı yerde durup kaydedilir, onay gelince kaldığı yerden devam eder;
  - akış uygulama panelinin anladığı biçime çevrilir;
  - her adımın harcaması ayrı yazılır.
- **Araçlar:** `ASSISTANT_TOOLS`'un kendisi; aynı kod, sunucu içinde doğrudan çalışır (`AssistantContext`: kullanıcının Supabase oturumu, kullanıcı kimliği, `appUrl`). Zod şeması JSON Schema olarak verilir, girdi çalışmadan önce aynı şemayla doğrulanır.
- **Onay kuralı tek yerden:** aracın `annotations.readOnlyHint`'i `false` ise uygulamada onay kartı gerekir (bugün 7 araç: `add_places`, `create_plan`, `update_plan`, `save_list`, `log_visit`, `delete_visit`, `update_places`). Aynı mesajda okuyan ve yazan araç birlikte çağrılırsa hepsi onaydan sonra çalışır; red, yazan araca "kullanıcı onaylamadı" sonucu döner.
- **Talimat tek kaynak:** `mcp.ts`'teki `INSTRUCTIONS` ortak bir modüle taşınır; MCP sunucusu ve uygulama içi ajan aynı metni kullanır. Uygulamaya özgü kısa bir ek: yazma işlemleri uygulamanın onay kartıyla onaylanır.
- **Düşünme ve effort:** Opus 5.5'te düşünme her zaman açık, derinliği `output_config.effort` belirler. Seçim eval'den.
- **Önbellek:** sistem talimatı ve araçlar sohbet boyunca sabit, geçmiş yalnız büyüyor; üst seviye `cache_control` her isteğin son bloğuna kadar önbelleğe alır. Önceki adımlar önbellekten okunur (Opus 5.5'te önbellek okuması normal girişin yirmide biri).
- **Web araması:** Anthropic'in sunucu aracı `web_search_20260209`, `max_uses: 3`. Uzun sürerse dönen `pause_turn` döngüde devam ettirilir.
- **Sınırlar:** tur başına en fazla adım sayısı ve `max_tokens`; `refusal` ve `max_tokens` duruşları ayrıca ele alınır.
- **Bütçe:** her turdan önce bu ayın `assistant_spend` toplamı $100'e bakılır. Doluysa tur başlamaz, açık bir mesaj döner. Console'daki organizasyon limitine çarpınca API'nin verdiği hata ("You have reached your specified API usage limits") anlaşılır bir mesaja çevrilir.
- **Telemetri:** her adımın kullanımı loglanır; Langfuse izleri elle kurulur (AI SDK'nın otomatik izleri bu yolda yok).

## Uygulama içi kapı

- **Yeni route** `POST /api/assistant/chat`; eski `/api/ai/chat` panel geçince kalkar. Panel yalnız yeni mesajı (ya da onay cevabını) ve sohbet kimliğini gönderir.
- **Akış biçimi:** sunucu, panelin bugün anladığı akış biçimini (AI SDK'nın UI message stream'i: metin, araç çağrısı, onay isteği, araç sonucu) Claude'un akışından kendisi üretir. Panelin akış ve onay mekaniği yerinde kalır.
- **Panel değişiklikleri:**
  - 16 araç için ortak bir araç kartı ve yazan araçlar için ortak onay kartı (bugün yalnız 8 Gemini aracına özel kartlar var);
  - açılışta son sohbet sunucudan yüklenir — sayfa yenilense de sohbet kaybolmaz;
  - "Yeni sohbet" yeni bir sohbet açar.
  - Tasarım `/ui-ux-pro-max` ile.
- **Kalkanlar:** `src/lib/ai/chat-tools.ts`, `src/lib/ai/prompts/chat.ts`, `/api/ai/chat` ve `chat` AI bütçesi. `ai_chat` SKU'su geçmiş satırlar için tanımlı kalır.

## Eval

- `scripts/assistant-eval/`: 10–12 gerçek istek (Türkçe ve İngilizce), örneğin:
  - "bu ay tek başıma 3-4 trendy restoran dene, yorumlara bak, beğenilen tabakları söyle";
  - "Kadıköy'de cumartesi brunch";
  - "dün Bolland & Crust'a gittim, 4 puan";
  - "şu Maps linkini ekle".
- Ayarlar: Opus 5.5 ve Sonnet 5.5, iki-üç effort seviyesi.
- Kütüphane Ozan'ın hesabından okunur. Yazan araçlar eval'de çalışmaz: model onlara çağrıyı önerdiği yerde durur, önerilen çağrı kaydedilir. Yani eval veriye dokunmaz.
- Ölçülen: doğru araç seçimi, cevabın kalitesi ve dili, tur başına süre ve dolar.
- Sonuçlar Ozan'a öneriyle sunulur; seçilen model ve effort bu dokümana yazılır.

## Geçiş yolu

1. **Şema** (3 tablo) — SQL gösterilir, onayla uygulanır. Çalışan kodu etkilemez; tablolar yeni.
2. **Çekirdek ve eval:** `src/lib/agent/`, `@anthropic-ai/sdk`, talimatın ortak modüle taşınması; eval koşulur, model seçilir.
3. **Uygulama içi kapı:** yeni route, panel değişiklikleri, eski Gemini sohbetinin kaldırılması, Settings'teki maliyet tablosuna Claude harcaması.
4. Dokümanlar ve kayıt.

## Regresyon listesi

- Sohbet yenilemede kaybolmaz (bugün kayboluyor); "Yeni sohbet" eskisini silmez.
- Uygulama içi asistan 8 yerine 16 araç görür: `compare_places` yerine `get_places`, `get_stats` yerine `get_library_overview`. `add_to_list` / `create_list` yerine `save_list`, `set_visit_status` yerine `update_places` / `log_visit`.
- Cevap süresi değişebilir: Claude'da düşünme açık, Gemini Flash'tan yavaş olabilir — eval ölçer.
- Bütçe sayı bazından dolar bazına geçer; `chat` AI bütçesi kalkar.
- Langfuse'da sohbet izlerinin biçimi değişir.

## Değerlendirilip reddedilenler

- **AI SDK'nın Anthropic sağlayıcısı** (`@ai-sdk/anthropic` + `streamText`): en az kod, ama resmi SDK değil. Geçmişi tarayıcı mesaj biçiminden geçirdiği için düşünme bloklarının değişmeden dönmesini garanti etmiyor.
- **Anthropic'in MCP bağlayıcısı** (Claude'un `/api/mcp`'ye bağlanması): kelimesi kelimesine aynı kapı olurdu. Ama kullanıcının erişim token'ını Anthropic'e gönderir, bir ağ atlaması ekler ve yerelde çalışmaz. Araçların aynı kod olması yeterli.
- **Claude Managed Agents:** döngüyü Anthropic'in sunucusunda çalıştırır; bu sohbet için ağır. Faz 6'daki zamanlanmış haftalık keşif ajanı için aday.
- **Harcamayı `api_usage`'a yazmak:** o tablo günlük sayaçtır (her çağrı +1, SKU başına sabit fiyat). Claude'un tutarı token'a göre her çağrıda değişir; sayaçla dolar tavanı tutulamaz.

## Maliyet

- **Birim:** milyon token (MTok). Fiyatlar Claude API skill'indeki model kataloğundan; uygulamada canlı fiyat sayfasıyla doğrulanacak:
  - Opus 5.5: $4 giriş / $20 çıkış, önbellek okuması $0.20.
  - Sonnet 5.5: $2 / $10, önbellek okuması $0.10.
  - Haiku 5.5: $0.10 / $0.50 (100K token'a kadar).
  - Web araması: 1.000'de $10.
- **Ücretsiz kota:** yok. Ozan'ın aylık ~$200 Claude API kredisi var ([[personal-assistant]] karar 3).
- **Ölçülen kullanım:** uygulama içi sohbet ayda 0–20 tur (yukarıda).
- **Tahmin (ölçülmedi):** tur başına Opus 5.5 ~$0.1–0.3, Sonnet 5.5 yaklaşık yarısı. Ayda birkaç dolar; eval gerçek rakamı ölçer.

## Ozan'ın işleri

- `ANTHROPIC_API_KEY` ana klasörün `.env.local`'ine eklendi; worktree'ninkine kopyalandı (23.11.2026).
- Console'da organizasyon düzeyinde aylık $100 limit ([[personal-assistant]] karar 10).

## Uygulama durumu

| Adım | Durum (23.11.2026) |
|---|---|
| Şema | SQL hazırlandı, onay bekliyor |
| Çekirdek ve eval | — |
| Uygulama içi kapı | — |
