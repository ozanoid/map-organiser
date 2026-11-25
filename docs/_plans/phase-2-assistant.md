---
title: "Faz 2 — Platform asistanı Claude'a: tasarım"
type: plan
domain: ai
version: 1.11.0
last_updated: 24.11.2026
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

> **Onaylandı (Ozan, 23.11.2026):** aşağıdaki altı karar önerildiği gibi. [[personal-assistant]] planının Faz 2'si. Şema SQL'i Ozan'a gösterildi ve onayıyla uygulandı (23.11.2026).

## Ne anladım

- Faz 2 "uygulama içi sohbetin modelini değiştirmek" değil, **sunucu tarafında ortak bir Claude ajanı** kurmaktır. claude.ai'ın kullandığı araç katmanını (`src/lib/assistant/tools`, 16 araç) Claude API üzerinden platformun kendisi de kullanır.
- İlk kapı uygulama içi asistan paneli. Sonraki fazlar aynı çekirdeği kullanır: Telegram sohbeti (Faz 3), plan sonrası e-postaya verilen cevaplar (Faz 4), haftalık keşif ajanı (Faz 6).
- Gemini'nin diğer işleri (Instagram okuma, mekan profili, sıralama, AI Plan, arama, karşılaştırma) **Claude'a taşınır** (Ozan, 23.11.2026): iş başına yol ve sıra aşağıda, "6. karar".

## Kararlar (Ozan, 23.11.2026)

| # | Konu | Karar |
|---|---|---|
| 1 | Sıra | Faz 2 şimdi, "ortak ajan çekirdeği + ilk kapı uygulama içi sohbet" olarak. |
| 2 | Sohbet geçmişi | Sunucuda kalıcı, yalnız sona eklenir (aşağıda neden). |
| 3 | Yazma onayı | Uygulamada onay kartı: yazan bir araç, kullanıcı karttan onaylamadan çalışmaz. |
| 4 | Model ve effort | Ücretli eval ile seçilir (Opus 5.5 ve Sonnet 5.5, iki-üç effort seviyesi; tahmini $3–7, ölçülmedi). **Seçildi: Sonnet 5.5, effort high** (Ozan, 23.11.2026, eval'den sonra; eval $5.03). |
| 5 | Web araması | Açık; tur başına en fazla 3 arama. **Ölçümden sonra (Ozan, 23.11.2026):** sınır Claude çağrısı başına 3 (`max_uses`); bir mesaj birkaç çağrıdan oluşabildiği ve süzme kodu bir çağrıda 4 arama yapabildiği için pratikte mesaj başına 3–4 — böyle kalıyor. **Değişti (Ozan, 24.11.2026):** oturum açılmış denemede 3 dar geldi (süzme kodu üç aramayı ilk adımda harcadı, toparlanamadı); sınır çağrı başına **10** — bütçe değil, kontrolden çıkan bir döngüye karşı emniyet; aramaya model karar verir, harcamayı aylık tavan ve turdaki 10 çağrı sınırlar. Önceden başlamış sohbetler 3 ile devam eder. |
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

SQL: `supabase/migrations/20261123123953_assistant_conversations.sql` — uygulandı (23.11.2026); tablo dokümanı [[../02-backend/schema/assistant-conversations]]. Özet:

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
- **Web araması:** Anthropic'in sunucu aracı `web_search_20260209`, `max_uses: 10` (çağrı başına; karar 5, 24.11.2026'da 3'ten 10'a). Bizim kodumuz aramaz: araç listede açık durur, aramaya Claude karar verir, Anthropic yürütür; sonuçları süzmek için Claude'un yazdığı küçük kod Anthropic'in kum havuzunda çalışır. Uzun sürerse dönen `pause_turn` döngüde devam ettirilir.
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
- **Tasarım kararları (Ozan, 24.11.2026 — önerildiği gibi):** taslaklar A–D (araç ilerlemesi, okunur plan / liste onay kartları, kaydedilince linkli "Saved" kartı, durum ve hata mesajları). İlk sürümde **Durdur yok** (tur sunucuda sürer, en fazla 10 adım); **kart beklerken yazılabilir** — yeni mesaj kartı "kaydedilmedi" olarak kapatır, kartın altında uyarı; **"Haritada göster"** arama ve sıralama sonuçlarında kalır; panelin düğme ve menüleri **İngilizce** (uygulama gibi), cevaplar kullanıcının dilinde; ilk sürümde **yalnız son sohbet ve "New chat"** — sohbet listesi ve silme sonra; boş ekranda **Türkçe örnek istekler**. Panel sayfa yenilense ya da kapansa da tur sunucuda tamamlanır; açılınca "yazılıyor" görünür, cevap gelince yerine oturur. Panel hazır bir istekle açılabilir (6.1'in girişi).
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

## Eval sonuçları (23.11.2026)

`npm run eval:assistant` (`scripts/assistant-eval/`): 12 gerçek istek (7 Türkçe, 5 İngilizce), Ozan'ın kütüphanesi (`ozan@maporganiser.com`), uygulamanın kullanacağı döngüyle (`src/lib/agent/run-turn.ts`). Yazan araçlar hiç çalışmadı: model onay kartında durdu, öneri kaydedildi; bir vakada kart reddedildi.

| Ayar | Doğru araç + doğru yazma önerisi | Vaka başı | Ortalama tur süresi | Okunan cevaplardan |
|---|---|---|---|---|
| Opus 5.5, effort medium | 12/12 | $0.096 | 19.9 sn | En derin: açılış saati ve yoğunluk kontrolü, plana rezervasyon linki ve kişi başı tutar. Ara adımlarda İngilizce kısa notlar cevaba sızıyor ("Need to find place id.") — talimat düzeltmesinden sonra da sürdü. |
| Sonnet 5.5, effort high | 12/12 | $0.048 | 15.8 sn | Opus'a yakın derinlik (saat kontrolü, 5 mekanın yorumları, planda yedek bar). Talimat düzeltmesinden sonraki iki koşuda not sızıntısı yok. |
| Sonnet 5.5, effort medium | 11/12 | $0.029 | 13.4 sn | Daha yüzeysel: planda saat kontrolü yok, "Doğrudan çağırayım" gibi süreç cümleleri sızıyor. |
| Opus 5.5, effort low | 9/12 | $0.058 | 13.5 sn | En zayıf: yorum okumadan "yorumcular övüyor" diyor, plan notları tek kelime, "Need place id. Search." gibi notlar. |

- **Harcama:** eval toplam **$5.03** (209 Claude çağrısı, 16 web araması; `assistant_spend`, `purpose = 'eval'`) — onaylanan $3–7 içinde. Ayrıca `rank_places` (Gemini) ve `search_google_maps` kendi küçük ücretli çağrılarını yaptı (`api_usage`).
- **Ortak sabit ön ek ~27.000 token** (sistem talimatı ~1.380, 16 aracın tanımı ~19.800 — `update_plan` tek başına ~5.500 —, web araması ~5.900; ücretsiz `count_tokens` ile ölçüldü). Sohbetin ilk çağrısında önbelleğe yazılır (Opus 5.5'te $0.135, Sonnet 5.5'te $0.067), sonraki çağrılarda yirmide bir fiyatla okunur. 5 dakika boşta kalınca yeniden yazılır.
- **Süre:** çoğu bekleme araçlarda: `rank_places` (Gemini) 15–40 sn, web araması 15–27 sn; model adımı 1–15 sn. İlk metin genellikle bütün araçlardan sonra geliyor (ortalama 9–21 sn), bu yüzden panelin araç ilerlemesini göstermesi gerekiyor.
- **Bulunan ve düzeltilen (talimat ve bağlam):**
  - Yazma önerisinden önce ne kaydedileceğini anlatma: tek değişikliklerde artık bir cümle var ("Dünkü ziyareti kaydediyorum: Bolland & Crust, 22 Kasım, 4 puan…"). Plan ve listelerde iki model de metinsiz karta gidiyor → **onay kartı, önerilen planı / listeyi okunur biçimde kendisi göstermeli** (uygulama içi kapının işi).
  - Tarih hesabının cevaba yazılması ("Saturday is 2026-11-28.", "Dün = 2026-11-22."): bağlam satırı artık dünü ve önümüzdeki 6 günü tarihleriyle veriyor; sızıntı kayboldu.
  - Hitap: aynı sohbette "sen" ve "siz" karışıyordu; uygulama içi asistanın talimatı Türkçede "sen" diyor — **Ozan onayladı (23.11.2026)**. claude.ai'ın talimatında bu satır yok.
- **Karar 5'ten sapma (ölçüldü, Ozan kabul etti):** `max_uses: 3` istek başına sınır, ama `web_search_20260209`'da aramayı modelin yazdığı kod yaptığında bir çağrıda 4 arama faturalandı. Sınır pratikte ~3–4; arama başı $0.01. Asıl maliyet arama ücreti değil, sonuçları okumanın token'ı: Sonnet'te arama yapılan çağrı $0.106 tuttu, $0.03'ü arama. Seçenekler (sınırı 2'ye indirmek, süzmeyen eski sürüm) konuşuldu; böyle kalıyor (Ozan, 23.11.2026). 24.11.2026'da denemeden sonra sınır 10'a çıktı (yukarıda, karar 5).
- **Karar (Ozan, 23.11.2026): Sonnet 5.5, effort high** — önerildiği gibi. Araç seçimi ve derinlik Opus 5.5 medium'a yakın, yarı fiyat, tur başına ~4 sn daha hızlı, son koşularda not sızıntısı yok; Opus 5.5 medium daha zengin ama iki kat pahalı ve ara notları cevaba sızıyor. `DEFAULT_AGENT_MODEL` (`src/lib/agent/models.ts`) buna çevrildi.

## 6. karar — Gemini'nin işleri Claude'a (Ozan, 23.11.2026)

Yön: Gemini'nin yaptığı her iş Claude'a geçer. İş başına iki yol: **modeli değiştirmek** (iş ayrı bir çağrı olarak kalır, aynı talimat ve çıktı şablonu, Gemini yerine Claude) ya da **işi asistana vermek** (ayrı çağrı kalkar; asistan veriyi araçtan alır, kararı kendisi verir). Kullanılmayan ve asistanın karşıladığı özellikler kaldırılabilir.

Envanter (kod: `generateText` / `streamText` çağıran her yer; kullanım: `api_usage`, tüm hesaplar, Haziran–Kasım 2026):

| İş | Kod | Ne zaman | Kullanım | Yol |
|---|---|---|---|---|
| Eski uygulama içi sohbet | `src/app/api/ai/chat/route.ts`, `src/lib/ai/chat-tools.ts` | Paneldeki her mesaj | Tem 17, Ağu 3, sonra 0 | Kaldırılır — uygulama içi kapıyla (5. karar) |
| `rank_places` sıralama hakemi | `src/lib/assistant/tools/rank-places.ts` → `src/lib/ai/rank-engine.ts` | Asistan / claude.ai öznel sorunca | Tem 22, Kas 34 (çoğu eval) | **Asistana verilir**: araç kısa profilleri döndürür, sıralamayı konuşan Claude yapar — **yapıldı (24.11.2026, v1.49.0, dalda)**, aşağıda |
| Arama çubuğu yapay zekâ modu | `src/app/api/ai/parse-query/route.ts`, `src/app/api/ai/rank-results/route.ts` | Arama çubuğuna doğal dille yazınca | Tem 18 (+ sıralama), Ağustos'tan beri 0 | **Asistana devredilir** (6.1) |
| AI Plan | `src/app/api/ai/day-plan/route.ts` | Plan sayfasındaki düğme | Tem 8, Kas 1 | **Asistana devredilir** (6.1) |
| Karşılaştır | `src/app/api/ai/compare/route.ts` | Karşılaştırma ekranı | Tem 2, sonra 0 | **Asistana devredilir** (6.1) |
| Mekan profili yazma | `src/lib/ai/generate-profile.ts` (zenginleştirme kuyruğu, yenileme cron'u, elle zenginleştirme) | Kayıttan sonra arka planda | Ağu 515 (toplu doldurma), Eki 20, Kas 6 | **Model değiştirildi**: Sonnet 5.5, medium (6.2 kararı; v1.51.0, dalda) |
| Instagram postu okuma | `src/lib/instagram/read-post.ts` (yalnız metin: açıklama, etiketler, profil yazıları) | Kısayol ya da sohbette Instagram linki | Eki 12, Kas 6 | **Model değiştirildi**: Haiku 5.5, high (6.2 kararı; v1.51.0, dalda) |

Claude'un canlı model bilgisinde (Models API, 23.11.2026) girdi türü olarak yalnız görsel ve PDF var, video ve ses yok. Faz 5'teki video anlama işi orada ayrı karar.

Kararlar:
- **6.1 — A:** arama çubuğunun yapay zekâ modu, AI Plan ve Karşılaştır asistana devredilir: düğme ya da arama çubuğu asistanı açar ve isteği hazır yazar ("Bu planı günlere dağıt"); kaydeden sonuç onay kartıyla gelir. Uygulama içi kapıdan sonra. Kapının tasarımı bunun için "asistanı hazır bir istekle açma" girişini içerir.
- **6.2 — ölçümden sonra:** profil yazma ve Instagram okuma için Haiku 5.5 mi Sonnet 5.5 mi. Instagram: 35 postluk eval iki modelle, şart bugünkü gibi sıfır yanlış. Profil: ~10 mekanda Gemini / Haiku / Sonnet profilleri yan yana. Tahmini ~$1–2 (ölçülmedi).
- **6.2 ölçümü yapıldı (24.11.2026; Ozan'ın onayıyla, Haiku effort high; toplam ≈ $1.42):**
  - *Instagram okuma* (35 post, 1'i silinmiş, eklenecek 42 yer): Gemini 35 doğru, 1 isteğe bağlı, **0 yanlış** (%83.3); **Haiku 5.5 high 36 doğru, 1 isteğe bağlı, 0 yanlış** (%85.7), okuma başı $0.00076 (Gemini ~$0.0014), cevapsız okuma yok. Haiku şartı geçti; Sonnet koşulmadı (plan gereği).
  - *Profil* (10 yer, aynı istem, hiçbir şey kaydedilmedi): Gemini 10/10, alıntıların %84'ü yorumlarda birebir, 30 sn; **Haiku 5.5 high** 10/10, %94, 40 sn, profil başı $0.006; **Sonnet 5.5 medium** 10/10, %97, 15 sn, profil başı $0.047. Kategori 10 yerin 9'unda aynı (LX Factory: Gemini Müze ve Kültür, iki Claude da Alışveriş). Yan yana sayfa: https://claude.ai/artifact/5GY7RV3aX3fio8qatL4cUN.
  - Bulgu: yapılandırılmış çıktıda iki UUID biçimli dizi profil şemasını "derlenemeyecek kadar büyük" yaptı; Claude'a giden şema biçimsiz, cevap tam şemayla kodda doğrulanıyor.
  - 900 profil (6.3) tek tek: Haiku ≈ $5.6, Sonnet ≈ $42; toplu iş API'siyle yaklaşık yarısı.
- **6.2 kararı (Ozan, 24.11.2026):** Instagram okuma **Haiku 5.5 (high)**, profil yazma **Sonnet 5.5 (medium)**. Tek kullanıcılı kullanımda maliyet karar ölçütü değil (ayda 400 yer eklemek, bütün adımlarla ≈ $10–27). **Uygulandı (v1.51.0, dalda):** `PROFILE_WRITER` / `INSTAGRAM_READER` (`models.ts`), deftere `profile` / `instagram` türüyle yazılıyor, aylık tavanla duruyor; eski Gemini sayaçları ve bütçeleri bu ikisi için kalktı; Ayarlar'da Claude harcaması türüne göre. Defterin tür listesini genişleten migration Ozan'ın onayıyla uygulandı (24.11.2026, sürüm 20261124225502). Instagram'ın ayda 300 post sınırı Gemini bütçesiyle kalkmıştı; o sınır HikerAPI ve DataForSEO aramalarını da sayıyla sınırlıyordu, Claude tavanı ise yalnız okumanın dolarını sayıyor. **Ozan'ın kararı (24.11.2026): şimdilik aynı sayı başlatmada sınır olarak geri geldi** (`INSTAGRAM_MONTHLY_POST_LIMIT` = 300, `import_jobs`'tan sayılır, aşınca 429 `monthly_limit`); **kalıcı çözüme sonra bakılacak**: bütün ücretli servisler (Claude, DataForSEO, HikerAPI, Mapbox) için tek aylık dolar tavanı — kendi tasarımıyla.
- **6.3 kararı (Ozan, 24.11.2026): evet**, Batch API'siz, düz çağrılarla — `npm run regen:profiles` (yorumu olan 895 yer; tahmini ≈ $38–42, ≈ 1 saat). Ozan'ın kararları: **yalnız profil** (etiket, alt kategori ve kategori önerileri uygulanmaz), **bütün hesaplar**. **Yapıldı (24.11.2026):** 889 profil yeniden yazıldı (kayıtlı yorumu olan her yer; yorum listesi boş 6 yer dışarıda), 893 çağrı $28.28 — profil başı ≈ $0.032, tek başına yazılan profil ≈ $0.05–0.08 (önbellek yazılırken); kanıt alıntılarının %97.1'i yorumlarda birebir (noktalama dışında). 4 cevapta bozuk etiket kimliği bütün profili düşürmüştü; kimlikler artık tek tek kontrol ediliyor, o 4 yer yeniden yazıldı. Main'e merge edilene kadar production yeni ve yenilenen profilleri Gemini ile yazıyor; merge'den sonra `regen:profiles` bir kez daha çalıştırılacak.
- **6.3 — ölçüme göre:** mevcut ~900 profil Claude ile yeniden yazılsın mı. Haiku ve toplu iş API'siyle tahmini ~$1 (ölçülmedi).
- **6.4 — tek defter, tek tavan:** bütün Claude çağrıları (sohbet, eval, profil, Instagram…) `assistant_spend`'e yazılır ve aynı aylık $100 tavana girer. Defterin `purpose` listesine yeni türler bir migration'la eklenir (o iş başlarken, SQL gösterilerek). Tavan dolunca arka plan işi bekler: mekan kaydedilir, profili sonraki aya kalır.
- **`rank_places` yapıldı (24.11.2026, v1.49.0, dalda):** araç Gemini'ye sordurmuyor; filtreye uyan en yüksek puanlı 30 yeri (etiketle öne çıkanlar her zaman içinde) kısa profilleriyle (artılar, eksiler, en çok konuşulan 4 tema, ne için uygun) döndürüyor, sıralamayı konuşan Claude yapıyor; finalistlere `get_places` / `read_reviews` ile bakıyor. `rank-engine.ts` silindi; arama çubuğunun yapay zekâ modu dokunulmadı. Ozan'ın kararları: uygulamadaki asistan önerdiği kayıtlı yerleri uygulamadaki sayfasına linkler ve panel bir yanıtın linklediği yerler için "Show these N on map" sunar (1A); ölçüm onaylandı. **Ölçüm** (eval'in 6 öznel sorusu, Sonnet 5.5 high, 23.11'deki Gemini'li koşuyla aynı sorular): seçimler büyük ölçüde aynı (brunch ve romantik liste birebir, Lizbon'un ilk 7'si aynı; tek başına trendy'de tezgâh oturmasına göre daha isabetli seçimler); tur süresi ortalama 22.3 → 15.5 sn, araç 0.4 sn; Claude maliyeti 6 soruda $0.394 → $0.607 (Gemini'nin çağrı başı $0.02'si düşünce soru başına ~$0.02–0.035 fazla). Havuz tahminimden büyük çıktı: 16–22 bin token (tahmin 9–12 bin). Koşunun maliyeti $0.61 (tahmin $0.3–0.6). **Aday sayısı 30 kalır** (Ozan, 24.11.2026; 20'ye indirmek token'ı üçte bir azaltırdı).
- **6.5 — sıra:** (1) uygulama içi kapı, içinde eski Gemini sohbetinin kaldırılması; (2) `rank_places`'in asistana verilmesi (yapıldı, 24.11.2026); (3) profil ve Instagram için model değişikliği, ölçümle (yapıldı, v1.51.0; migration uygulandı, 6.3 bitti); (4) düğmelerin asistana devri — tasarım onaylandı (Ozan, 25.11.2026, altı öneri), üç dilim: **1. dilim yapıldı (v1.52.0, dalda)** — istek konusu (`<subject>`), kalıcı taslak, ortak erişim kontrolü, kayıttan sonra bütün ekranların yenilenmesi, Karşılaştır'ın asistana devri ve Gemini karşılaştırmasının kaldırılması; 2. dilim plan (araçlara konum ve "o gün açık mı", planın sonrasını gösteren kart ve çakışma kontrolü — SQL'i gösterilecek), AI Plan'ın devri; 3. dilim filtre arama kutusunda "Ask the assistant" ve ölü yapay zekâ arama hattının kaldırılması; (5) Gemini kütüphanesinin (`@ai-sdk/google`) ve `GOOGLE_GENERATIVE_AI_API_KEY`'in kaldırılması.

## Kod incelemesi ve düzeltmeler (23.11.2026)

Bağımsız bir inceleme çekirdekte üç önemli bulgu çıkardı; ikisi gerçek, biri canlı API'de doğrulanınca düştü:

1. **Onaylanan bir yazma iki kez çalışabiliyordu.** Araç önce çalışıyor, sonucu sonra sohbete yazılıyordu. İki sekme ya da çift tık iki plan oluşturabilirdi; sonucu yazamayan bir hata kartı yeniden açardı. İleride Telegram'ın geciken cevabı tekrar göndermesiyle bu sıradanlaşır.
   - **Çözüm (kalıcı):** her araç çağrısı çalışmadan önce kararıyla birlikte kaydedilir, sonucu sonra eklenir (`assistant_tool_runs`). Aynı çağrıyı ikinci kez kaydetmek veritabanında imkânsızdır.
   - Sohbete ulaşmamış bir sonuç kayıttan okunur, araç yeniden çalışmaz. Yarıda kalan çalışma için modele "sonucu belirsiz, önce kontrol et" denir.
   - Ayrıca sohbet başına tek tur kilidi var: ikinci istek para harcamadan "cevap hâlâ yazılıyor" alır.
2. **Kullanıcı kendi sohbet satırını yazabiliyordu.** Kendi talimatı ve araçları olan bir sohbet açıp platformun anahtarı ve bütçesiyle çalıştırabilirdi; sign-up kapalı olduğu için bugün risk düşük.
   - **Çözüm:** bu tablolara yalnız sunucu yazar; kullanıcı okur ve sohbetini silebilir.
3. **"Ardışık aynı rol mesajları 400 verir" endişesi.** Canlı API'de denendi: iki kullanıcı mesajı, iki asistan mesajı ve araç sonucunun ardından yeni bir kullanıcı mesajı kabul ediliyor ve tek tur gibi okunuyor. Hata yolları sohbeti bozmuyor; düzeltme gerekmedi.

Küçük bulgular da düzeltildi:
- Kopan akış artık durduruluyor; yoksa sunucu üretmeye ve faturalamaya devam ediyordu.
- Geçersiz girdili bir yazma onay kartı açmıyor; hata modele hemen dönüyor.
- Adım sınırında model bir kez daha çağrılıp elindekini söylüyor.
- Panelin olay işleyicisi hata atarsa tur durmuyor ve yeniden faturalanmıyor.
- Yedek modele geçilen bir istekte reddeden deneme doğru modelin fiyatından sayılıyor.

**Şema değişikliği uygulandı (Ozan'ın onayıyla, 23.11.2026; sürüm 20261123143607):** `supabase/migrations/20261123143607_assistant_turns_and_tool_runs.sql`. İçeriği:
- kullanıcının iki INSERT policy'si kaldırılıyor;
- `assistant_conversations.turn_lease_until` sütunu ekleniyor;
- `assistant_tool_runs` tablosu açılıyor (sahibi okur, yazan yalnız sunucu).

Uygulamadan önce ve sonra canlı veritabanında geri alınan bir işlem içinde denendi, hepsi beklendiği gibi. Sunucunun bu tablolara yazan kodu da canlı veritabanında, hiçbir şey yazmadan sınandı (`npm run check:agent:db`, 10 kontrol): her sorgu geçerli, hiçbir satır yazılmadı.

Ücretsiz kontrol: `npm run check:agent` — sahte bir Claude istemcisiyle döngünün her yolu, 70 kontrol, hepsi geçiyor.

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
| Şema | Uygulandı (Ozan'ın onayıyla, 23.11.2026; sürüm 20261123123953). Uygulandıktan sonra doğrulandı: üç tabloda RLS açık, altı policy, bir tetikleyici |
| Çekirdek ve eval | Yazıldı, `feat/personal-assistant` dalında (main'de değil); hiçbir route henüz çağırmıyor. Eval koşuldu ($5.03), sonuçlar yukarıda. İnceleme bulguları düzeltildi; ikinci şema adımı uygulandı (sürüm 20261123143607). Model: Sonnet 5.5, effort high (Ozan, 23.11.2026) |
| Uygulama içi kapı | Tasarım onaylandı (24.11.2026), yazıldı (v1.48.0, dalda): `/api/assistant/chat` ve `/api/assistant/conversation`, yeni panel (araç satırları, okunur onay kartları, kalıcı sohbet, "Show on map"), Ayarlar'da Claude satırı; eski Gemini sohbeti ve `chat` bütçesi kaldırıldı. Bağımsız incelemenin bulguları düzeltildi (24.11.2026): kart cevabında çift mesaj, reddedilen istekte sonsuz yeniden gönderme, eski sekmenin görmediği kartı reddetmesi, yeniden yüklemede tekrar tıklanabilen "kaydediliyor" kartı, kaybolan hata notu ve gönderilmemiş mesaj, "New chat"in eski sohbete geri dönmesi, harita kimlik sınırı, yanıttaki resimlerle veri sızdırma. Bunun için üçüncü migration (`opened_at`, `last_turn_*`) Ozan'ın onayıyla uygulandı (24.11.2026, sürüm 20261124143554). Derleme ve 120 çevrimdışı kontrol geçiyor. **Oturum açılmış tarayıcıda uçtan uca denendi (24.11.2026, admin test hesabı, 13 Claude çağrısı, $0.21):** arama ve "Show on map", reddedilen ve yenilemeden sonra onaylanan liste kartı, yanıt yazılırken yenileme, "New chat", iki sekmede eski kart (409, hiçbir şey kaydedilmedi) çalıştı; çıkan üç küçük eksik düzeltildi, web araması sınırı 10'a çıktı (karar 5). main'e geçiş Ozan'ın onayını bekliyor |
