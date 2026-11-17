---
title: "Kişisel mekan ve gezme asistanı — yön planı"
type: plan
domain: overview
version: 1.0.0
last_updated: 17.11.2026
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
| — | Public sign-up'ı kapat | Kod `feat/personal-assistant` dalında; Supabase'deki "Allow new users to sign up" ayarını Ozan kapatacak |
| 0 | Claude'a kapı: MCP server + OAuth (okuma) | Tasarım onay bekliyor |
| 1 | Planlama | Sırada |
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
| 10 | Bütçe | Platform tarafındaki Claude API harcaması için şimdilik aylık $100 tavan. Anahtar Vercel'de `ANTHROPIC_KEY` adıyla (Production + Preview). |

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

### Faz 0 — Claude'a kapı: MCP server + OAuth (okuma)

Amaç: claude.ai'da (mobil dahil) ve Claude Code'da kayıtlı mekanlarla konuşabilmek.

- **Endpoint:** `/api/mcp` (Streamable HTTP). Paket seçimi (Vercel `mcp-handler` ile resmi MCP TypeScript SDK'nın sürüm uyumu) kurulumda doğrulanır.
- **Yetkilendirme:** Supabase OAuth 2.1 server (beta; beta süresince ücretsiz). Discovery, dinamik client kaydı (DCR) ve token'ları Supabase yönetir; uygulama yalnız onay ekranını barındırır: `/oauth/consent` (Site URL + Authorization Path). `/.well-known/oauth-protected-resource` metadata'sı MCP istemcisini Supabase'e yönlendirir.
- **Onay ekranı güvenliği:** DCR herkese açık olduğu için onay yalnız izinli redirect URI'lere verilir (claude.ai callback `https://claude.ai/api/mcp/auth_callback`, Claude Code'un localhost callback'i) ve yalnız sahip hesap(lar) onaylayabilir.
- **Token doğrulama:** her istekte. Asimetrik JWT anahtarıyla JWKS üzerinden yerel doğrulama (Supabase OAuth için bunu öneriyor; zorunlu olduğu tek yer OIDC ID token'ı); HS256'da Auth sunucusuna sorarak. Tool'lar token'ın kullanıcısıyla, RLS altında çalışır.
- **Okuma tool'ları v1:**
  - `search_places` — metin, şehir, kategori, tag, ziyaret durumu, puan
  - `get_place` — tüm detay: not, yorum özeti, Instagram kaynağı, listeler
  - `nearby_places` — bir noktanın ya da mekanın çevresi
  - `taste_profile` — en çok kaydedilen kategoriler, mutfaklar, şehirler; yüksek puanlılar; gidilen / gidilecek sayıları
  - `list_collections` — listeler, tag'ler, şehirler
- **Server instructions:** verinin anlamı (`visit_status`, puan, kaynak) ve planlamada nasıl kullanılacağı.
- **Şema değişikliği:** yok.
- **Ozan'ın dashboard adımları:** OAuth Server'ı aç, Authorization Path `/oauth/consent`, DCR açık; (önerilen) asimetrik JWT anahtarına geçiş — legacy secret revoke edilmez, anon ve service_role anahtarları ona bağlı.
- **Test:** tool mantığı dalda test edilir. Uçtan uca OAuth akışı ancak production'da denenebilir: onay ekranı Site URL'de olmalı ve claude.ai preview'a Deployment Protection yüzünden ulaşamaz. Bu yüzden Faz 0 sonunda main merge onayı gerekir.
- **Bitti tanımı:** claude.ai'da custom connector olarak ekli; mobil ve web'de "Londra'da kaydettiğim ama gitmediğim yerlerden bu cumartesi için öneri" gibi sorular gerçek veriyle cevaplanıyor.

### Faz 1 — Planlama

- **Plan veri modeli** faz başında yazılı netleşir ve onaylanır (açık soru 1). Mevcut `trips` / `trip_days` / `trip_day_places` yapısı aday.
- **Yazma tool'ları:** plan oluştur / güncelle, plana mekan ekle / çıkar, mekanı listeye ekle, ziyaret durumu ve puan güncelle. Yazmalar da RLS altında ve geri alınabilir.
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
- **Platform tarafı Claude API** (Faz 2 ve sonrası): aylık $100 tavan, iki katman — Console spend limit (organizasyon ya da ayrı workspace) ve uygulama içi bütçe.
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
  - Paylaşım linkini iptal etme arayüzü yok; public shared trip her görüntülemede Mapbox Directions çağırıyor (cache ve rate limit yok).
  - Lint borcu (`any`, React Compiler kuralları).

## Açık sorular

1. Faz 1 plan veri modeli: `trips` üzerine mi, yeni bir `plans` tablosu mu? (Faz 1 başında; şema değişikliği onayla.)
2. Görsel okuma modeli: Haiku 5.5 mi Sonnet 5.5 mi? (Faz 5'te eval ile.)
3. Telegram yalnız bildirim mi, sohbet kapısı da mı? (Sohbet, platform asistanı üzerinden API kredisi harcar.)
4. Arkadaş listesi ve gruplar veri modeli (Faz 3).
5. Keşif kaynak listesi: hangi hesaplar ve bloglar (Faz 6; saved koleksiyondan aday çıkarılacak).
6. Instagram export'unun içeriği (koleksiyon adı ve post linkleri) dosya gelince doğrulanacak.

## Bu dokümanın bakımı

Her faz başlarken bu dokümanda tasarımı netleşir ve Ozan onaylar; faz bitince "Faz durumu" tablosu güncellenir. Ölçülen maliyetler "Maliyet ve bütçe" bölümüne yazılır.
