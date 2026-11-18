---
title: "Kişisel mekan ve gezme asistanı — yön planı"
type: plan
domain: overview
version: 1.6.3
last_updated: 18.11.2026
status: stable
related:
  - "[[../00-overview/system-overview]]"
  - "[[../02-backend/auth]]"
  - "[[../05-flows/instagram-import-flow]]"
  - "[[../04-integrations/hikerapi]]"
  - "[[../04-integrations/gemini]]"
  - "[[backfill-grandfather-reenrich]]"
---

# Kişisel mekan ve gezme asistanı — yön planı

> 17.11.2026'da Ozan'ın kabul ettiği yön. Önceki kanonik yol haritası
> (`feature-suggestions_v4`) bununla arşive kaldırıldı; ondan devralınanlar
> aşağıda: [[#v4 yol haritasından devralınanlar]].

## Özet

- Map Organiser, arkadaşların da kullanacağı arayüz odaklı bir ürün olarak kurulmuştu. Ozan buna yeterli zaman ayıramıyor; altyapı onun **kişisel mekan ve gezme asistanına** dönüşüyor.
- Platform kapanmıyor. Veri girişi (iOS Shortcut "Add to MapOrganiser", Google Maps linki, Instagram importu, Takeout), veritabanı ve harita olduğu gibi kalıyor. **Tek doğruluk kaynağı Supabase veritabanı.**
- Yeni katman **"tek beyin, çok kapı"**: platformun verisi ve eylemleri tek bir tool katmanı (MCP server) olarak açılır. claude.ai sohbetleri (web, desktop, mobil), Claude Code, platformun kendi asistanı, zamanlanmış keşif ajanı ve bildirim kanalları aynı katmanı kullanır.
- Öncelik **planlama**, sonra keşif. Planlama globaldir (kaydı olan her şehir); keşif şimdilik Londra ile sınırlı.

## Faz durumu

| Faz | Konu | Durum (17.11.2026) |
|---|---|---|
| — | Public sign-up'ı kapat | Tamam: kod `feat/personal-assistant` dalında; Supabase'de kayıt kapalı (`disable_signup: true`, doğrulandı 17.11.2026) |
| 0 | Claude'a kapı: MCP server + OAuth | **Tamam (17.11.2026):** main'de, claude.ai'a bağlı. Okuma tool'ları connector üzerinden gerçek token'la doğrulandı; `update_places` henüz gerçek kullanımda denenmedi |
| 1 | Planlama ve ziyaretler | Tasarım v2 onaylı: [[phase-1-planning]]. Şema uygulandı (18.11.2026); `search_google_maps` main'de. **Dilim 1 (plan modeli dönüşümü) kodu `feat/personal-assistant` dalında hazır (v1.37.0)** — arayüz tarayıcıda uçtan uca denendi (18.11.2026); main'e alınması Ozan'ın onayını bekliyor. Sırada dilim 2 (ziyaretler) |
| 2 | Platform asistanı Claude'a | Sırada |
| 3 | İletişim (e-posta, Telegram, WhatsApp linki, davet sayfası) | Sırada |
| 4 | Geri bildirim döngüsü | Sırada |
| 5 | Instagram saved koleksiyonu + görsel/video anlama | Sırada (export Ozan'dan gelecek) |
| 6 | Haftalık Londra keşfi | Sırada |

## Kararlar (Ozan, 17.11.2026)

| # | Konu | Karar |
|---|---|---|
| 1 | Hesap | ozan@maporganiser.com ile devam. ozanketenci@gmail.com hesabıyla birleştirme yok; son veriler için Ozan yeni export verecek ya da toplu import yapacak. |
| 2 | Öncelik | Önce planlama, sonra keşif. |
| 3 | Beyin | Claude. Aylık ~$200 Claude API kredisi ve Claude Ultra aboneliği var. Planlama ve öneriler normal Claude sohbetlerinden de alınabilmeli — "tek beyin, çok kapı" onaylandı. |
| 4 | Planlama | Serbest ve ajan tabanlı, kural motoru değil ("bu ay tek başıma 3-4 trendy restoran dene, yorumlara bak, beğenilen tabakları söyle"). Global. |
| 5 | Keşif | Şimdilik Londra. Kaynaklar güvenilen Instagram hesapları ve bloglar; öneriler haftalık gelir, onaylananlar sisteme eklenir. |
| 6 | Bildirim | E-posta zorunlu (ozanketenci@gmail.com) ve otomatik. Telegram otomatik. WhatsApp davet linkiyle — gruba otomatik mesaj yok. İleride plan, arkadaş grubuna "katılıyorum / katılmıyorum" butonlu davet olarak gider. |
| 7 | Geri bildirim | Plan sonrası e-posta: gittin mi, puanın, ne yedin, fotoğraf var mı. |
| 8 | Instagram | "london" saved koleksiyonu baştan sona taranıp eklenecek (resmi export ile). Koleksiyondaki hesaplar Ozan'ın onayıyla keşif kaynağı olabilir. Etiketsiz postlar için görsel tanıma ve video/ses anlama eklenecek; bu, Instagram importunun v1'deki "video analizi yok" kararını değiştirir. |
| 9 | Kayıt | Public sign-up kapalı. |
| 10 | Bütçe | Platform tarafındaki Claude API harcaması için şimdilik aylık $100 tavan; limiti Ozan Console'da organizasyon seviyesinde koyar. Anahtar Vercel'de SDK'nın standart adıyla: `ANTHROPIC_API_KEY` (Production + Preview). |

## Mimari: tek beyin, çok kapı

```
 KAPILAR — Claude'un konuştuğu yerler
 ┌───────────────────┬──────────────┬────────────────────┬──────────────────────┐
 │ claude.ai         │ Claude Code  │ Platform asistanı  │ Haftalık keşif       │
 │ web·desktop·mobil │              │ (uygulama içi)     │ ajanı (zamanlanmış)  │
 │ custom connector  │ MCP          │ Claude API         │ Managed Agents       │
 └─────────┬─────────┴──────┬───────┴─────────┬──────────┴───────────┬──────────┘
           └────────────────┴────────┬────────┴──────────────────────┘
                                     ▼
              TOOL KATMANI  /api/mcp  (OAuth 2.1 · kullanıcı token'ı · RLS)
              search_places · get_place · nearby_places · taste_profile · …
                                     ▼
              SUPABASE DB  places · lists · tags · trips/plans · import kuyruğu · api_usage
                ▲                                                  │
 VERİ GİRİŞİ ───┘                                                  └─── ÇIKIŞ KANALLARI
 iOS Shortcut · Maps linki · Instagram · Takeout     e-posta · Telegram · WhatsApp linki · davet/RSVP sayfası
```

İlkeler:

1. **Tek doğruluk kaynağı veritabanı.** Kanallar ve ajanlar kendi kopyasını tutmaz; okuyup yazdıkları her şey DB'dedir.
2. **Tool'lar tek yerde tanımlanır.** MCP server ve platform asistanı aynı tool tanımlarını kullanır; bir kapı için ayrı kopya yazılmaz.
3. **Yetki kullanıcının token'ıdır.** Tool'lar kullanıcı adına, RLS altında çalışır. Service role yalnız arka plan işlerinde (kuyruk, cron) kalır.
4. **Zekâ modelde, veri ve eylem tool'larda.** Planlama kuralları koda gömülmez; tool'lar veriyi ve eylemleri sağlar, planı model kurar.
5. **Dışarıdan gelen öneri onaysız eklenmez.** Keşif önerileri ve görsel/videodan çıkarılan mekanlar onay kuyruğuna düşer. Ozan'ın kendi paylaştığı, mekanı tag'li postlar bugünkü gibi otomatik eklenir.
6. **Maliyet ölçülerek büyür.** Her yeni AI çağrısı `api_usage`'a yazılır ve bütçe korumasından geçer.

## Fazlar

Sıra Ozan'ın önceliğidir: önce planlama, sonra iletişim, en son keşif. Her faz başlarken tasarımı bu dokümanda netleşir ve Ozan onaylar.

### Faz 0 — Claude'a kapı: MCP server + OAuth

Amaç: claude.ai'da (mobil dahil) ve Claude Code'da kayıtlı mekanlarla konuşabilmek ve plan kurabilmek.

- **Endpoint:** `/api/mcp` (Streamable HTTP). Paket seçimi (Vercel `mcp-handler` ile resmi MCP TypeScript SDK'nın sürüm uyumu) kurulumda doğrulanır.
- **Yetkilendirme:** Supabase OAuth 2.1 server (beta; beta süresince ücretsiz). Discovery, dinamik client kaydı (DCR) ve token'ları Supabase yönetir; uygulama yalnız onay ekranını barındırır: `/oauth/consent` (Site URL + Authorization Path). `/.well-known/oauth-protected-resource` metadata'sı MCP istemcisini Supabase'e yönlendirir.
- **Onay ekranı güvenliği:** DCR herkese açık olduğu için onay yalnız izinli redirect URI'lere verilir (claude.ai callback `https://claude.ai/api/mcp/auth_callback`, Claude Code'un localhost callback'i) ve yalnız sahip hesap(lar) onaylayabilir.
- **Token doğrulama:** her istekte. Asimetrik JWT anahtarıyla JWKS üzerinden yerel doğrulama (Supabase OAuth için bunu öneriyor; zorunlu olduğu tek yer OIDC ID token'ı); HS256'da Auth sunucusuna sorarak. Tool'lar token'ın kullanıcısıyla, RLS altında çalışır.
- **Tool'lar:** [[#Tool tasarımı (öneri)]].
- **Server instructions:** verinin anlamı (ziyaret durumu, puanlar, tag'ler, kaynak); planlama akışı (önce özet, sonra arama ya da sıralama, detay, yorum); kütüphane dışı önerileri (Claude'un web araması) "kayıtlı değil" diye ayırma; Google Maps linki verme; kullanıcının dilinde cevap.
- **Şema değişikliği:** yok.
- **Ozan'ın dashboard adımları** (17.11.2026'da ölçülen durum): kayıt kapalı ✓, OAuth server açık ✓, imza anahtarı ES256 ✓ (JWKS). Dynamic client registration açık (17.11.2026 — ayar Save'e basınca devreye giriyor). Authorization Path ve Site URL doğru: claude.ai onay ekranına geldi. `ASSISTANT_OWNER_EMAILS` Vercel'de (Ozan).
- **Test:** tool mantığı dalda test edilir. Uçtan uca OAuth akışı ancak production'da denenebilir: onay ekranı Site URL'de olmalı ve claude.ai preview'a Deployment Protection yüzünden ulaşamaz. Bu yüzden Faz 0 sonunda main merge onayı gerekir (Ozan 17.11.2026'da bu sırayı onayladı).
- **Bitti tanımı:** claude.ai'da custom connector olarak ekli; mobil ve web'de "Londra'da kaydettiğim, perşembe akşamı açık, yorumlarında yemeği övülen yerlerden üç öneri" gibi sorular gerçek veriyle cevaplanıyor.

#### Tool tasarımı (öneri)

İlk taslak (5 tool) veri modeline ve tek bir örneğe bakılarak yazılmıştı. 17.11.2026'da Ozan'ın sorusu üzerine yeniden türetildi: gerçek veri ölçüldü, uygulama içi asistanın mevcut 8 tool'u incelendi, Ozan'ın bu yöndeki bütün senaryoları eşlendi. **Onaylandı (Ozan, 17.11.2026); `update_places` Faz 0'a alındı.** Uygulama ve ölçümler: [[../04-integrations/claude-mcp]].

**Ölçülen veri** (ozan@maporganiser.com, 17.11.2026)

- 291 mekan, 7 ülke. Londra 192, Lizbon 22; İstanbul mekanları ilçe adlarıyla kayıtlı (Kadıköy 14, Beyoğlu 9, Fatih 6 …); Amsterdam 7, Brighton 6, Toulouse 5.
- Google/DataForSEO ve AI verisi zengin: yorum metni 288 mekanda (mekan başına ~50, toplam ~14.400); AI profili 287 (özet, artı/eksi, tema içgörüleri ve alıntılar, uygun olduğu durumlar); Google puanı 289; fiyat 285; haftalık saatler 265; saatlik yoğunluk 217; rezervasyon linki 140; özellikler 288; "people also search" benzer mekanlar 273; alt kategori 245; 90 tag (ör. Accepts Reservations 141, Good Value 73, Sunday Roast 39, Group Gatherings 28, Laptop Friendly 22).
- Kişisel sinyal neredeyse yok: kendi puanın 0 mekanda, ziyaret durumu yalnız 5 mekanda (hepsi want_to_go), not 2, liste 0, trip 0, fotoğraf 0.
- 14 mekan kalıcı kapalı, 2 geçici kapalı.
- Şehir araması "Istanbul" (noktasız I) ile 0 mekan buluyor, "İstanbul" ile 39; Türkiye'de 52 mekan var. Mevcut sorgu katmanı Türkçe "İ"yi eşlemiyor.

**Bulguların tasarıma etkisi**

1. İlk taslaktaki `taste_profile` (puan ve ziyaretten zevk çıkarmak) bugün dayanaksız; çıkarıldı. Neyi kaydettiğin zevkin vekili olarak `get_library_overview`'da. Puan ve ziyaret verisi `update_places` ve Faz 4 geri bildirimiyle dolacak.
2. Yorumlar en büyük varlık: "beğenilen tabaklar" için ayrı bir yorum okuma tool'u gerekiyor.
3. "Perşembe akşamı" gibi planlar için `open_now` yetmez: belirli gün ve saatte açık mı, o saatte ne kadar kalabalık.
4. Kalıcı kapalı mekanlar aramada varsayılan olarak dışarıda.
5. Global planlama için şehir eşleşmesi Türkçe karakterlere ve ilçe adlarına dayanıklı olmalı (ülke ve yakınlık filtresi de var). "İ" düzeltmesi Faz 0'da asistan araçlarının kendi sorgu katmanında yapıldı (katlanmış metinle eşleşme). Ortak `queryPlaces` (places sayfası, uygulama içi asistan) bu fazda değişmedi: aynı sorgu her seferinde `google_data`'nın tamamını çekiyor (291 mekanda ~20 MB), asıl düzeltme SQL tarafında ve payload'la birlikte yapılmalı — açık soru 9.
6. Uygulama içi asistan aynı veri üzerinde 8 tool'a sahip — okuma: `search_places`, `rank_places`, `get_place_details`, `compare_places`, `get_stats`; onaylı yazma: `add_to_list`, `create_list`, `set_visit_status`. Yeni tool'lar aynı sorgu katmanını (`queryPlaces`) ve sıralama motorunu kullanır.

**Senaryolar** (Ozan'ın söyledikleri ve genel planlama işleri)

| # | Senaryo | Gereken |
|---|---|---|
| S1 | "Bu ay tek başıma 3-4 trendy restoran öner, yorumlarına bak, beğenilen tabakları söyle" | arama, popülerlik ya da vibe sıralaması, yorum okuma |
| S2 | "Perşembe akşamı X'e gidiyorum, gelmek isteyen? şusu güzel" | o saatte açık mı, rezervasyon, yoğunluk, öne çıkanlar |
| S3 | Londra'da semt bazlı akşam ya da hafta sonu planı (brunch → kahve → akşam) | yakınlık, saat, sıra |
| S4 | "Barcelona'ya onlarca mekan attık, orada da planla" | şehir ve ülke filtresi, global |
| S5 | Romantik akşam, laptopla çalışılacak kafe, arkadaş grubuyla pub | anlamsal sıralama, tag |
| S6 | "X mi Y mi?" | yan yana detay |
| S7 | "Yemekten sonra yakında ne var?" | bir mekanın çevresinde arama |
| S8 | "Dün X'e gittim, 4 puan, kuzu çok iyiydi" (Faz 4) | yazma |
| S9 | "Şu linki, postu ya da mekanı kaydet" | ekleme |
| S10 | "Bu haftanın önerileri; 2 ve 4'ü ekle" (Faz 6) | öneri kuyruğu |
| S11 | "Bana benzer yeni yerler" | benzer mekanlar ve Claude'un web araması |
| S12 | "Gitmediğim yerler" — bugün 286 mekanın ziyaret bilgisi yok | toplu işaretleme |

**Faz 0 tool'ları — okuma**

| Tool | Ne yapar | Senaryo | Kaynak |
|---|---|---|---|
| `get_library_overview` | Şehir ve ülkeler (ilçe adlarıyla), kategori, alt kategori, tag ve liste adları sayılarıyla; ziyaret durumu dağılımı (bilinmeyen dahil); kapalı mekanlar; son eklenenler. Claude filtrelerdeki adları buradan öğrenir. | hepsi | `get_stats` ve asistanın taksonomi bloğu |
| `search_places` | Şehir ya da ülke; yakınlık (bir mekan, koordinat ya da semt adı ve yarıçap); kategori, alt kategori, tag, liste (adla); ziyaret durumu; Google puanı ve yorum sayısı; fiyat; belirli gün ve saatte açık; kaynak (Instagram); eklenme tarihi. Kapalılar varsayılan olarak dışarıda. Sıralama: puan, popülerlik, mesafe, yeni eklenen. Kısa sonuç (en fazla 25) ve toplam sayı. | S1 S3 S4 S7 S12 | mevcut `search_places`, genişletilmiş |
| `rank_places` | Öznel kritere ("romantik", "laptop dostu", "trendy") göre AI ile puanlayıp gerekçesiyle sıralar. Gemini çağrısı yapar; mevcut aylık bütçe sınırına tabi. | S1 S5 | mevcut `rank_places` |
| `get_places` | 1–5 mekanın tam detayı: AI profil, haftalık saatler, verilen zamanda açık mı ve ne kadar kalabalık, fiyat, rezervasyon / web / Maps linki, telefon, senin durumun ve notun, tag'ler, listeler, Instagram kaynağı, kaydetmediğin benzer mekanlar. Karşılaştırma da bununla yapılır. | S2 S6 S11 | `get_place_details` ve `compare_places` birleşir |
| `read_reviews` | Bir mekanın kayıtlı yorumlarından konuya ya da kelimeye göre süzülmüş kısa alıntılar ("ne yenir", "tatlı", "kuzu"), puan ve tarihle. | S1 S2 | yeni; veri hazır |

**Karar (Ozan, 17.11.2026):** `update_places` (ziyaret durumu, kendi puanın, not, tag) Faz 0'a alındı — 286 mekanın ziyaret bilgisi yok ve claude.ai'dan "bunlara gittim" diye toplu işaretlemek bunu doldurmanın en hızlı yolu.

**Sonraki fazların tool'ları** (faz başında netleşir)

| Tool | Faz | Ne yapar | Senaryo |
|---|---|---|---|
| `update_places` | 0 (yapıldı) | Bir ya da çok mekana ziyaret durumu, kendi puanın, not; tag ekle / çıkar | S8 S12 |
| `add_place` | 1 | Google Maps linki, Instagram postu ya da "ad + şehir" ile ekler; emin değilse aday listesi döner | S9 S11 |
| `save_plan`, `get_plans` | 1 | Planı tarih, saat, durak ve notlarla kaydeder; planları getirir | S1–S4 |
| `manage_lists` | 1 | Liste oluştur, mekan ekle / çıkar | — |
| `route_between` | 1 (opsiyon) | Duraklar arası yürüme ya da toplu taşıma süresi ve sıra (Mapbox) | S3 S4 |
| `send_plan` | 3 | Planı e-posta ya da Telegram'a gönderir, davet linki üretir | S2 |
| `get_suggestions`, `review_suggestions` | 6 | Haftalık önerileri getirir, onaylar ya da reddeder | S10 |

**Tasarım ilkeleri**

- Filtreler adla: Claude kategori, tag ya da liste adını yazar; sunucu ID'ye çevirir, bulamazsa geçerli adları önerir. ID uydurma riski ve fazladan çağrı yok.
- Kısa çıktı: arama kompakt; detay ve yorum ayrı tool'larda. claude.ai'ın bağlamı şişmez.
- Okuma tool'ları `readOnlyHint` ile işaretli; yazmalar ayrı tool'larda ve claude.ai her yazmada onay ister.
- Kütüphane dışı öneriler (Claude'un web araması) "kayıtlı değil" diye ayrılır; Faz 1'de `add_place` ile eklenebilir.
- Tek tanım: tool'lar tek modülde yazılır; MCP server şimdi, uygulama içi asistan Faz 2'de aynı modülü kullanır. Mevcut `chat-tools.ts` o zamana kadar değişmez.

### Faz 1 — Planlama

> Tasarım v2 (18.11.2026, onaylandı): [[phase-1-planning]] — trip tabloları tek `plans` modeline dönüşür (tarih tek kaynakta, yapısal saat, iptal durumu), ziyaretler ayrı varlık olur (`visits`), tarihsiz hedefler liste kalır; mekan arama DataForSEO'dan. Aşağıdaki maddeler ilk taslaktır; geçerli olan o dokümandır.

- **Plan veri modeli** faz başında yazılı netleşir ve onaylanır (açık soru 1). Mevcut `trips` / `trip_days` / `trip_day_places` yapısı aday.
- **Tool'lar:** `update_places`, `add_place`, `save_plan` / `get_plans`, `manage_lists`, opsiyonel `route_between` ([[#Tool tasarımı (öneri)]]). Yazmalar da RLS altında ve geri alınabilir.
- **Dış bilgi:** claude.ai kendi web aramasını kullanır; tool'lar kayıtlı yorumları (Google / DataForSEO) ve mekan profilini verir. Platform tarafındaki web araması Faz 2'de.
- **Bitti tanımı:** "bu ay tek başıma 3-4 trendy restoran" gibi bir istekten kaydedilmiş, platformda görünen bir plan çıkıyor.

### Faz 2 — Platform asistanı Claude'a

- Uygulama içi asistan (bugün Gemini; v4'teki AI-02 v1) Claude API'ye (`@anthropic-ai/sdk`) taşınır ve Faz 0-1'in tool katmanını kullanır.
- Model ve effort seçimi eval ile. Platform tarafındaki dış bilgi için Claude'un web search tool'u (1.000 arama başına $10).
- **Bütçe koruması:** Claude maliyeti token'dan hesaplanıp `api_usage`'a yazılır; aylık $100 tavan uygulama içinde de uygulanır (mevcut `checkAiBudget` deseni). Console limitine çarpınca API'nin döndüğü hata (HTTP 400, "You have reached your specified API usage limits") anlaşılır bir mesaja çevrilir.
- Diğer Gemini işleri (Instagram okuma, zenginleştirme, profil) yerinde kalır; taşımak ayrı karar.

### Faz 3 — İletişim

- **E-posta** (Resend; maporganiser.com için gönderici alan adı doğrulaması): plan özeti, hatırlatma, haftalık özet → ozanketenci@gmail.com.
- **Telegram bot:** otomatik bildirim; sohbet kapısı olup olmayacağı açık soru 3.
- **WhatsApp:** davet linki paylaşımı (wa.me ya da paylaşım menüsü). Grup API'si resmi işletme hesabı (OBA) ister, en fazla 8 katılımcı alır ve butonlu mesaj desteklemez; bu yüzden otomatik grup mesajı yok.
- **Davet / RSVP sayfası:** plan için public sayfa, "Katılıyorum / Katılmıyorum" butonları; arkadaş listesi ve gruplar (veri modeli açık soru 4).

### Faz 4 — Geri bildirim döngüsü

- Plan tarihinden sonra e-posta: gittin mi, puanın, ne yedin, fotoğraf.
- Cevap mekan kaydını günceller (ziyaret durumu, puan, not, fotoğraf) ve `taste_profile`'ı besler.

### Faz 5 — Instagram saved koleksiyonu + görsel/video anlama

- **Koleksiyon:** Instagram'ın resmi export'u (JSON) → "london" koleksiyonundaki post linkleri → mevcut import kuyruğu, toplu. Export bu fazdan önce gelirse linkler bugünkü importla erkenden alınabilir; etiketsiz kalanlar görsel/video hattı gelince yeniden denenir.
- **Görsel/video:** HikerAPI analiz yapmaz; post verisini ve medyanın geçici CDN linklerini verir (`image_versions`, `resources`, `video_url`, `accessibility_caption` …). Sistem medyayı hemen indirir ve modele gönderir:
  - görseller (tek ya da carousel) → Claude vision;
  - reel → Gemini (video ve ses birlikte; Claude video ve ses almaz).
- **Kademeli maliyet:** önce bugünkü ucuz adımlar (tag, konum, caption); bulunamazsa görsel; o da yetmezse reel videosu.
- Görsel/videodan çıkan adaylar onaya düşer.
- Koleksiyondaki hesaplar keşif için kaynak adayı olarak Ozan'a sunulur.

### Faz 6 — Haftalık Londra keşfi

- Claude Managed Agents scheduled deployment (haftalık). Ajan MCP tool'larıyla Ozan'ın kayıtlarını ve zevk profilini bilir; onaylı kaynakları tarar (HikerAPI `/g2/user/medias`, `/g2/user/clips`; bloglar için web).
- Ajan medyayı kendisi işlemez: Faz 5'teki post okuma hattını tool olarak çağırır, aday mekanları geri alır.
- Çıktı: öneri listesi → e-posta / Telegram + platformda onay kutusu → onaylananlar import kuyruğuna.

## Maliyet ve bütçe

- **claude.ai ve Claude Code kullanımı** Ultra aboneliğinden; MCP çağrıları API kredisi harcamaz. Tool'ların arkasındaki maliyet (Supabase, Google, DataForSEO) bizde ve bugünkü gibi `api_usage`'a yazılır.
- **Platform tarafı Claude API** (Faz 2 ve sonrası): aylık $100 tavan, iki katman — Console'da organizasyon seviyesinde aylık limit (Ozan koyar) ve uygulama içi bütçe.
- **Görsel/video ve keşif** maliyetleri ilk partide ölçülüp buraya yazılacak; şu an ölçülmüş rakam yok.

## v4 yol haritasından devralınanlar

v4'ün açık backlog'u çok kullanıcılı ürün içindi. Bu yönle:

- **Yeni fazlara katılanlar:** AI-02 asistan → Faz 2; AI-09 trip planner → Faz 1; AI-10 fotoğraftan mekan → Faz 5; F-15 bildirimler → Faz 3; F-18 takvim (iCal) → Faz 3'te seçenek.
- **Öncelik dışı** (iptal değil; Ozan isterse geri gelir): onboarding (NF-16), trip şablonları (NF-09 / F-24), harita yenilikleri (NF-12..15), offline PWA (F-20 / NF-23), native iOS (F-23), gamification (F-19), seyahat günlüğü (F-22 / NF-10), routing ve bütçe (NF-07 / NF-08), export (F-06 / NF-22), duplikat birleştirme (F-12), zengin not ve medya (F-13), mood discovery (AI-13), öneri motoru (AI-07).
- **Bakım listesi** (yön değişse de geçerli):
  - Test yok — en azından kritik route'lara smoke test ve AI eval setleri.
  - `SECURITY DEFINER` fonksiyonların anon'a açık grant'leri daraltılmalı (Supabase advisor uyarısı).
  - Migration'lar dashboard'da yönetiliyor; şema snapshot'ı vault'ta güncel tutulmalı.
  - Model sürümü değişince profillerin yeniden üretimi; review'ların tek seferlik olması ([[backfill-grandfather-reenrich]]).
  - DataForSEO SKU'larında aylık tavan yok.
  - Paylaşım linkini iptal etme arayüzü yok; public shared plan her görüntülemede Mapbox Directions çağırıyor (cache ve rate limit yok).
  - Lint borcu (`any`, React Compiler kuralları).

## Açık sorular

1. Faz 1 plan veri modeli: `trips` üzerine mi, yeni bir `plans` tablosu mu? (Faz 1 başında; şema değişikliği onayla.)
2. Görsel okuma modeli: Haiku 5.5 mi Sonnet 5.5 mi? (Faz 5'te eval ile.)
3. Telegram yalnız bildirim mi, sohbet kapısı da mı? (Sohbet, platform asistanı üzerinden API kredisi harcar.)
4. Arkadaş listesi ve gruplar veri modeli (Faz 3).
5. Keşif kaynak listesi: hangi hesaplar ve bloglar (Faz 6; saved koleksiyondan aday çıkarılacak).
6. Instagram export'unun içeriği (koleksiyon adı ve post linkleri) dosya gelince doğrulanacak.
7. ~~`update_places` Faz 0'a alınsın mı?~~ Evet (Ozan, 17.11.2026).
8. `rank_places` testte 41–64 sn sürdü (Gemini). claude.ai'da Claude'un kendisinin değerlendirmesi — `search_places`'e kısa profil özetleri ekleyip Gemini'yi atlamak — daha hızlı ve muhtemelen daha isabetli. Onay olursa tool değişir.
9. Ortak `queryPlaces`: "İ" katlama ve ~20 MB payload. Kalıcı çözüm SQL tarafında (katlanmış metin kolonu + index, liste görünümü için hafif projeksiyon) — şema değişikliği, ayrı iş.

## Bu dokümanın bakımı

Her faz başlarken bu dokümanda tasarımı netleşir ve Ozan onaylar; faz bitince "Faz durumu" tablosu güncellenir. Ölçülen maliyetler "Maliyet ve bütçe" bölümüne yazılır.
