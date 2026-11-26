---
title: "Faz 3 — İletişim: tasarım"
type: plan
domain: sharing
version: 0.4.0
last_updated: 26.11.2026
status: draft
related:
  - "[[personal-assistant]]"
  - "[[phase-2-assistant]]"
  - "[[../01-domain/plans]]"
  - "[[../01-domain/sharing]]"
  - "[[../05-flows/share-flow]]"
  - "[[../04-integrations/claude-agent]]"
  - "[[../04-integrations/claude-mcp]]"
  - "[[../05-flows/notifications-flow]]"
  - "[[../02-backend/schema/notifications]]"
---

# Faz 3 — İletişim: tasarım

> [[personal-assistant]] planının Faz 3'ü. **14 karar onaylandı (25.11.2026, hepsi önerildiği gibi).** **Dilim 1 kodu `feat/personal-assistant` dalında (v1.57.0)**; migration'ı deneme çalıştırmasından geçti ve **Ozan'ın onayıyla uygulandı (25.11.2026, sürüm 20261125203540)**; ardından `notifications.plan_id` indeksi de uygulandı (sürüm 20261125224149) — durum ve tasarımdan sapmalar: [[#Dilim 1 — durum (25.11.2026)]]. Şema SQL'i her dilimin başında `supabase/migrations/` altında yazılır, Ozan'a gösterilir, onayıyla uygulanır.

## Ne anladım

Faz 3'ün amacı planların insanlara ulaşması — iki yönde:

1. **Ozan'a:** planın özeti, plandan önce hatırlatma, haftalık özet; e-postayla (ozanketenci@gmail.com) ve Telegram'dan. Karar 6 (17.11.2026): "E-posta zorunlu ve otomatik. Telegram otomatik."
2. **Arkadaşlara:** WhatsApp grubuna atılan bir davet linki; linki açan plana bakar, "Geliyorum / Gelmiyorum" der; Ozan kimin geldiğini görür. Karar 6: "WhatsApp davet linkiyle — gruba otomatik mesaj yok. İleride plan, arkadaş grubuna 'katılıyorum / katılmıyorum' butonlu davet olarak gider."

Ayrıca: takvime ekleme (iCal, v4'ten devralınan F-18 seçeneği) ve asistanın bunları yapabilmesi (`send_plan`). Plan sonrası "gittin mi" e-postası Faz 4'tür; bu tasarım onu ek bir bildirim türü olarak alabilecek şekilde kurulur.

## Bugün (ölçüm ve kanıt, 25.11.2026)

**Kullanım** (canlı veritabanı): bütün hesaplarda 7 plan var; Ozan'ın hesabında (ozan@) **hiç plan yok**, ileri tarihli plan da yok; ziyaret kaydı 0. Paylaşım linkleri kullanılıyor: plan 2 link / 14 görüntüleme, liste 3 / 14, mekan 1 / 3. Yani Faz 3 bugünkü bir alışkanlığı değiştirmiyor, yeni bir alışkanlık kuruyor — dilimler küçük ve tek başına işe yarar olmalı.

**Mevcut yapının eksikleri:**

| Eksik | Kanıt | Faz 3'e etkisi |
|---|---|---|
| Kullanıcının saat dilimi tutulmuyor | `profiles` kolonları (canlı şema): `time_zone` yok. Asistan saat dilimini her turda tarayıcıdan alıyor | Haftalık özetin "pazartesi 08:00"i hesaplanamaz |
| Planın saat dilimi var, ama türetilmiş | `src/lib/plans/read.ts:246` — son konumlu durağın mekanının IANA dilimi; mekan dilimi `src/lib/types/index.ts:353` | Hatırlatma planın yerel saatine göre kurulabilir; konumsuz planlarda yedek gerekir |
| Durağın bitiş saati yok | `plan_stops`: `start_time` ya da `day_part`, bitiş yok (`supabase/migrations/20261118005355_plans_tables.sql:61-73`) | Takvim etkinliğinin süresi varsayılanla kurulur |
| Paylaşım sayfası tamamen tarayıcıda | `src/app/shared/[slug]/page.tsx:1` `"use client"`; plana özel `og:` etiketi yok, yalnız `src/app/layout.tsx:13-24`'teki genel başlık | WhatsApp'ta linkin önizlemesi plan adını, tarihini göstermez |
| Paylaşım linki kısa | `src/app/api/shared/route.ts:69` `nanoid(10)` ≈ 60 bit; OWASP tahmin edilemez kimlikler için en az 64 bit istiyor [O1] | Yalnız okuma için kabul edilebilir; **yazma** yetkisi veren bir davet linki için daha uzun anahtar gerekir |
| Paylaşılan plan tam adresi ve sahibin adını veriyor | `src/app/api/shared/[slug]/route.ts:207-268` | Davette adresin cevaptan sonra açılması bir seçenek (karar 5) |
| Herkese açık sayfalar arama motoruna kapalı değil | `robots.ts` yok, metadata'da `robots` yok | `/shared` ve davet sayfaları `noindex` olmalı |
| Dışarıya mesaj gönderen hiçbir altyapı yok | kodda e-posta / Telegram yok; cron'lar `vercel.json`: `refresh-places` günde bir, `drain-imports` dakikada bir; herkese açık yollar `src/lib/supabase/proxy.ts:56-67` | Gönderim kaydı, zamanlama, kanal bağlama sıfırdan kurulur |

## Senaryolar

1. Ozan asistanla bir plan yapar; "bunu bana gönder" der ya da plan sayfasında **Bana gönder**'e basar → plan e-postasına ve/veya Telegram'ına gelir.
2. Plandan önceki akşam (ör. 18:00) ve plan sabahı (ör. 08:00) hatırlatma: duraklar, saatler, Google Maps linkleri.
3. Pazartesi sabahı haftalık özet: bu haftanın planları, davetlere gelen cevaplar.
4. Ozan bir plan için davet linki açar, WhatsApp grubuna atar; arkadaşlar linkte planı görür, cevap verir; her cevapta Ozan'a bildirim gelir, uygulamada liste görünür.
5. Arkadaş cevabını sonradan değiştirir (aynı telefondan).
6. Biri cevabını WhatsApp'ta yazmıştır; Ozan uygulamada onun adına girer.
7. Arkadaşlar ve Ozan planı takvimine ekler.
8. Plan değişir (tarih, durak): davet sayfası her zaman güncel planı gösterir; değişikliği gruba Ozan kendisi duyurur (arkadaşların iletişim bilgisi yok).
9. Plan iptal edilir: davet sayfası "iptal edildi" der, cevap alınmaz.
10. Asistan: "kimler geliyor?" (plan okuma cevapları da verir), "davet linkini aç / kapat", "planı Telegram'ıma at".

## Model

İlke: her bilgi tek yerde; gönderilen her mesaj kaydedilir (ne, kime, ne zaman — sonradan yeniden kurulamayan bilgi); zamanlama kaynak veriden türetilir (plan değişince hatırlatma kendiliğinden doğru kalır).

### Varlıklar

**1. `profiles.time_zone`** — kullanıcının IANA saat dilimi (`Europe/London`). Tarayıcıdan bir kez alınır, Ayarlar'da değişir. Bir bildirim ayarı değil, kullanıcıya ait bir bilgi; o yüzden profilde.

**2. `notification_channels`** — Ozan'ın mesaj alacağı yerler.
- `id`, `user_id`, `kind` (`email` | `telegram`)
- e-posta için `email` + `verified_at` (adrese giden tek tıklık onay linki — yanlış yazılmış bir adrese hatırlatma gitmesin)
- Telegram için `telegram_chat_id` (**bigint** — 52 bite kadar çıkabiliyor [T-A#chat]), `telegram_username`, `linked_at`
- `disabled_at` (ör. bot engellendi: Telegram 403 döner, kanal kendini kapatır)
- v1'de kullanıcı başına bir e-posta ve bir Telegram (`unique (user_id, kind)`).

**3. `telegram_link_tokens`** — Telegram'ı bağlamak için tek kullanımlık anahtar: `token_hash`, `user_id`, `expires_at` (15 dk), `used_at`. Anahtarın kendisi saklanmaz, yalnız hash'i. *(Dilim 1'de `channel_link_tokens` oldu: e-posta onayı da aynı tek kullanımlık linki istiyor; tek tablo, `purpose` ile ayrılır — `email_verify` 24 saat, `telegram_link` 15 dk.)*

**4. `notification_settings`** — kullanıcı başına bir satır, tür başına kanallar ve zamanlar:
- `reminder_channels` (`{email,telegram}` alt kümesi; boş = kapalı), `reminder_evening_time` (varsayılan 18:00, null = yok), `reminder_morning_time` (08:00, null = yok)
- `weekly_channels`, `weekly_day` (1 = pazartesi), `weekly_time` (08:00)
- `rsvp_channels` (davete cevap gelince)
- "Bana gönder" ayar istemez; her basışta kanal seçilir.

**5. `notifications`** — gönderim kaydı (outbox): gönderilecek ve gönderilmiş her mesaj bir satır.
- `id`, `user_id`, `kind` (`plan_summary` | `plan_reminder` | `weekly_summary` | `rsvp_received`; Faz 4'te `plan_followup`), `channel`, `plan_id` (null olabilir), `rsvp_id`
- `dedupe_key` **unique** — aynı hatırlatma iki kez yazılamaz: `reminder:<plan>:<tarih>:evening:email`, `weekly:<user>:<ISO hafta>:telegram`
- `due_at`, `status` (`pending` → `sending` → `sent` | `failed` | `skipped`), `attempts`, `claimed_until` (aynı satırı iki çalışma birden almasın), `last_error`
- `provider_message_id`, `sent_at`, `content` (gönderilen başlık ve metnin kopyası — plan sonradan değişse de ne gittiği bilinir)
- İçerik gönderim anında güncel veriden üretilir, sonra kaydedilir.

**6. `plan_invitations`** — bir planın daveti (plan başına bir tane).
- `id`, `plan_id` **unique** (plan silinince silinir), `user_id`
- `token` — 128 bit, 22 karakter (base64url); link `/invite/<token>`. Sahip linki tekrar kopyalayabilsin diye düz saklanır (paylaşım slug'ları gibi); yalnız sahip görür (RLS), herkese açık okuma API'de token ile.
- `status` (`open` | `closed`), `closed_at`, `token_rotated_at` (**yeni link**: eski link ölür, cevaplar kalır)
- Ayarlar: `allow_maybe` (varsayılan açık), `max_plus_ones` (varsayılan 3), `guest_list` (`after_answer` | `always` | `owner_only`, varsayılan `after_answer`), `address` (`after_answer` | `always`, varsayılan `after_answer`)
- Neden `shared_links` değil: o tablo liste / plan / mekan arasında polimorfik, salt okunur, 60 bitlik slug'lı; davetin kendi yaşam döngüsü (açık/kapalı, yenileme), yazma yetkisi ve ayarları var. Plan sayfasındaki mevcut "Copy share link" aynen kalır.

**7. `plan_rsvps`** — davete verilen her cevap.
- `id`, `invitation_id`, `name` (1–60 karakter), `response` (`yes` | `maybe` | `no`), `plus_ones` (0–`max_plus_ones`), `note` (≤ 280)
- `source` (`link` — misafir kendisi; `owner` — Ozan elle girdi; ileride `telegram`, `personal_link`)
- `device_key_hash` — cevabı veren cihaza bırakılan gizli anahtarın (httpOnly cookie, 128 bit) hash'i; aynı cihazdan cevap güncellenir, isim tekrar yazılmaz
- `created_at`, `updated_at`; Ozan istenmeyen bir cevabı siler.

**Sonraya bırakılanlar (eklemeli, bugünkü yapıyı bozmaz):** kişiye özel davet linki (`plan_rsvps` satırı önceden açılır, kendi token'ıyla), rehber ve gruplar (`contacts`, `plan_rsvps.contact_id`), Telegram'dan cevap (`source = telegram`). Karar 4 bunları soruyor.

### Yetki (RLS)

Yeni tabloların hepsinde RLS açık; okuma sahibine (`auth.uid() = user_id`). Yazmalar sunucudan: ayarlar sahibin kendi oturumuyla, `notifications` ve herkese açık cevaplar service role ile, sorgu kodda token / kullanıcıya göre daraltılarak (asistan tablolarıyla aynı desen). Herkese açık okuma yalnız API üzerinden, token ile, beyaz liste alanlarla.

## Akışlar

**Bana gönder** (plan sayfası ya da `send_plan`): API seçilen kanallar için `notifications` satırı yazar (`summary:<plan>:<istek id>`), hemen gönderir, sonucu satıra işler; arayüz "Gönderildi / Gönderilemedi" der.

**Zamanlanmış gönderimler** — yeni cron `/api/cron/notify`, 15 dakikada bir:
1. *Hatırlatma:* durumu `planned`, başlangıcı bugün ya da yarın olan planlar; hatırlatma anı planın yerel saatine göre hesaplanır (planın dilimi; konumsuz planda kullanıcınınki). Anı geçmiş ve `dedupe_key`'i olmayan her biri için satır yazılır ve gönderilir. Kaçırılan bir çalışma birkaç saat içinde telafi edilir; daha eskisi `skipped`. Çok günlü planda v1'de yalnız başlangıç hatırlatılır.
2. *Haftalık özet:* kullanıcının diliminde seçili gün ve saat; `weekly:<user>:<ISO hafta>`.
3. *Tekrar deneme:* `failed` olup 3'ten az denenmiş satırlar.

Hatırlatmalar plan tablosundan **türetilir**, önceden kuyruğa yazılmaz: plan tarihi değişince eski hatırlatmayı silmek / yenisini kurmak gerekmez. (Resend'in kendi zamanlayıcısı bunu iki yerde tutardı; seçilmeyenler.)

**Telegram'ı bağlama:** Ayarlar → Bildirimler → *Telegram'a bağla* → sunucu tek kullanımlık anahtar üretir → `t.me/<bot>?start=<anahtar>` açılır (payload en çok 64 karakter, `A-Z a-z 0-9 _ -` [T-F#deep-linking]) → Ozan Telegram'da *Start*'a basar → Telegram bize `/start <anahtar>` gönderir → anahtar doğrulanır, `chat_id` kaydedilir, bot "Bağlandı" der → Ayarlar "@kullanıcı olarak bağlı — Kopar" gösterir.

**Davet:**
1. Plan sayfası → **Davet et** → davet yoksa açılır (`plan_invitations`), link gösterilir.
2. **Paylaş:** telefonda paylaşım menüsü (`navigator.share({ text, url })` — iOS Safari 12.2+, Chrome Android 61+ [W2]); WhatsApp seçilir, grup seçilir. Paylaşım menüsü yoksa `https://wa.me/?text=<metin + link>` [W1] ve *Linki kopyala*. Grubu önceden seçen bir link yok [W1].
3. Arkadaş `/invite/<token>`'ı açar: plan adı, tarih, günler, duraklar, saatler, mekan adları, semt; ayara göre adres ve harita cevaptan sonra. Cevap bloğu: **ad** (etiketli alan), **Geliyorum / Belki / Gelmiyorum** (büyük düğmeler), **+N**, isteğe bağlı not.
4. `POST /api/invite/<token>/rsvp` → cevap yazılır (cihaz anahtarıyla), Ozan'a `rsvp_received` bildirimi gider (cevaptan hemen sonra, `after()` ile).
5. Cevap sonrası: "Cevabın kaydedildi", *Değiştir*, *Takvime ekle*, (ayara göre) katılanlar listesi.
6. Ozan plan sayfasında: Geliyor N · Belki N · Gelmiyor N, isimler, +N'ler, notlar; *Cevap ekle* (elle), *Sil*, *Daveti kapat*, *Yeni link*.

**Takvim:** `.ics` indirme — sahip için `/api/plans/<id>/calendar.ics`, davet sayfasında `/api/invite/<token>/calendar.ics`.
- Gün başına bir etkinlik: saatli durak varsa ilk duraktan son durak + 2 saate, yoksa tüm gün; açıklamada durakların saatleri ve Google Maps linkleri; `UID = <plan>-<gün>@maporganiser.com` (aynı dosya ikinci kez eklenince çoğalmaz).
- Saatler UTC (`Z`) ile yazılır, takvim yerel saate çevirir; bölgesiz ("floating") saat yok [C1]. `METHOD` ve `ATTENDEE` yok — RSVP davet sayfasında kalır [C1][C2].
- Abone olunan takvim akışı (webcal) şimdilik yok: Google mobilde abonelik açtırmıyor ve yenilemesi saatler sürüyor [C3][C4].

## Kanallar

### E-posta — Resend

- **Neden Resend:** çift gönderim koruması (`Idempotency-Key`, 24 saat), imzalı webhook, React ile şablon, Node SDK (`resend`) [R8][R9][R16]. Postmark'ta idempotency ve imzalı webhook yok, ücretsiz kotası ayda 100 [P1][P4][P6]; Amazon SES'te sandbox, IAM ve SNS kurulumu tek kişilik uygulama için ağır [S2].
- **Kota:** Free — ayda 3.000, günde 100 e-posta, 3 alan adı; aşılınca 429 döner, kuyruğa almaz [R1][R2]. Pro $20/ay, 50.000.
- **Alan adı:** *(uygulamada `mappy.site` — Ozan bunun için aldı, DNS'i Vercel'de; [[../04-integrations/resend]])* ayrı bir gönderim alt alanı, öneri `mail.maporganiser.com` (`send` olmaz: Resend dönüş adresi için `send.<alan>` kullanıyor) [R5][R6]. Kayıtları Resend üretir (MX + SPF TXT + DKIM; Ağustos 2026'dan sonra açılan alanlarda CNAME olabilir) [R4]. DMARC `p=none` ile başlar [R7].
- **Bölge:** gönderim bölgesi alan adı başına seçilir ve sonradan değişmez (eu-west-1 öneri). **Bütün hesap verisi ve kayıtlar bölgeden bağımsız ABD'de tutulur** [R22]; DPA'da SCC ve EU-US DPF var, Türkiye KVKK standart sözleşmesi yok [R24]. Yalnız Ozan'a giden e-postalarda bu bir sorun değil; arkadaş adresleri işe girerse karar konusu (karar 7).
- **Şablon:** React Email ile sunucuda `html` + düz metin; açılma / tıklama takibi kapalı.
- **Yeni alan adı:** ilk e-postalar Gmail'de spam'e düşebilir; Ozan "Spam değil" işaretler [R18].
- v1'de webhook yok (yalnız Ozan'a gidiyor); arkadaşlara e-posta gelirse bounce / şikâyet için eklenir [R15][R17].

### Telegram — bildirim botu

- Kurulum: @BotFather'da `/newbot` → token (bilen botu yönetir; sızarsa `/token` ile yenilenir) [T-F]. Bot gönderim için ücretsiz [T-B][T-Q].
- **Güncellemeler webhook'la:** Vercel'de sürekli açık süreç yok, `getUpdates` uymaz. `setWebhook` + `secret_token` → her istekte `X-Telegram-Bot-Api-Secret-Token` başlığı, sabit zamanlı karşılaştırma; `allowed_updates` dar (`message`, `my_chat_member`; RSVP butonları gelirse `callback_query`) [T-A#setwebhook]. Yanıt hızlı döner; tekrar gelen güncelleme `update_id` ile ayıklanır [T-A#update].
- **Gönderim:** HTML biçimi (yalnız `<`, `>`, `&` kaçışlanır; MarkdownV2'nin 18 özel karakteri kırılgan) [T-A#formatting-options]; mesaj ≤ 4096 karakter; 429'da `retry_after` kadar bekle; engellenince kanal kapanır [T-A#responseparameters].
- **Bot kimseye ilk yazamaz** — kişi önce botu başlatmalı [T-B]. Bu yüzden arkadaşlara Telegram'dan davet v1'de yok; asıl RSVP web sayfasında.
- **Preview ortamı:** bir botun tek webhook adresi olur [T-A#setwebhook]; Telegram test için ayrı bot öneriyor [T-F#testing-your-bot]. Preview'da Telegram kapalı kalabilir ya da ikinci bir test botu kullanılır (karar 13). Vercel'in preview koruması Telegram'ın POST'larını engelleyebilir (doğrulanmadı).
- **Sohbet kapısı (açık soru 3):** bota yazarak asistanla konuşmak teknik olarak hazır parçalarla mümkün (ajan çekirdeği kapıdan bağımsız; Telegram akışlı cevap için `sendMessageDraft` veriyor [T-A#sendmessagedraft]); her mesaj Claude kredisi harcar, onay kartları satır içi düğmelere döner. v1 önerisi: yalnız bildirim, sohbet kapısı ayrı bir dilim.

### WhatsApp — link

- `wa.me/?text=` resmi biçim; telefon ve WhatsApp Web'de çalışır; grup önceden seçilemez [W1]. Paylaşım menüsünde metin ve linkin tek mesaja düşüp düşmediği cihazda denenmeli [W3].
- **Önizleme:** WhatsApp `<head>` içinde boş olmayan `og:title`, `og:description`, `og:url` ve mutlak `og:image` (600 KB altı, en az 300 px, en/boy ≤ 4:1) ister; `<head>` ilk 300 KB'ta olmalı [W4]. Önizlemeyi gönderenin telefonu üretir — gönderilmiş mesajın önizlemesi sonradan değişmez [W5].
- Next.js 16: davet sayfası sunucu bileşeni olur, `generateMetadata` + plan başına `opengraph-image.tsx` (`ImageResponse`, 1200×630 PNG, Türkçe harfli font) [N1][N2]. Metadata akışında WhatsApp varsayılan "HTML-limited bot" listesinde, Telegram değil → `htmlLimitedBots`'a `TelegramBot` eklenir [N3].
- **WhatsApp Events** (5.11.2026'da duyuruldu, yayılıyor): davet linki, WhatsApp'ı olmayanlar tarayıcıdan RSVP, +1, hatırlatma [W6]. Bizim farkımız planın kendisi: günler, duraklar, harita, takvim. Kendi RSVP'mizi kurmak mı, WhatsApp'ınkini kullanmak mı — karar 11.

## Asistan

- **`send_plan`** (yazan araç, onay kartıyla): planı Ozan'ın kendi kanallarına gönderir (`channels: ["email","telegram"]`). Başkasına gönderme yok — iletişim bilgisi tutulmuyor, dışarıya mesaj onaysız gitmez.
- **`invite_to_plan`** (yazan araç, onay kartıyla): daveti açar / kapatır / linki yeniler; davet linkini ve WhatsApp'a hazır metni döndürür — Ozan kendisi paylaşır.
- **`get_plans`** planın davet durumunu ve cevap özetini de verir ("kimler geliyor?").
- İki kapı da (uygulama içi asistan ve claude.ai) aynı araçları kullanır. Araç tanımları sabit istemi büyütür; ilk turda önbellek bir kez yeniden yazılır.

## Arayüz (taslak; dilim başında `/ui-ux-pro-max` ile mockup)

- **Ayarlar → Bildirimler** (yeni sekme): e-posta adresi + *Test gönder* + onay durumu; Telegram *Bağla* / *@x olarak bağlı — Kopar*; hatırlatma (akşam 18:00 / sabah 08:00 / kapalı), haftalık özet (gün, saat), davet cevapları — her biri için kanal seçimi; saat dilimi (tarayıcıdan, değiştirilebilir).
- **Plan sayfası:** *Bana gönder*, *Davet et* paneli (link, paylaş, ayarlar, cevaplar, elle ekle, kapat / yeni link), *Takvime ekle*.
- **Davet sayfası** `/invite/<token>`: mobil öncelikli; etiketli alanlar (yalnız placeholder değil), en az 44 px düğmeler, gönderince yükleniyor → başarı durumu, kapalı / iptal / bulunamadı durumları, `noindex`.
- Bildirim metinleri: kısa başlık, tarih ve saat, durak listesi, plan linki; Telegram'da Google Maps linkleri.

## Güvenlik ve gizlilik

- Davet anahtarı 128 bit, iptal edilebilir (*Yeni link*), HTTPS; davet sayfasında üçüncü taraf script yok [O2].
- `noindex`: davet sayfaları ve mevcut `/shared` sayfaları için metadata + `X-Robots-Tag` (robots.txt yetmez) [G1].
- Davet sayfası beyaz liste: plan adı, tarih, gün sırası, saatler, mekan adları, semt / şehir; adres ve harita pinleri ayara göre cevaptan sonra; notlar, maliyet, durak sonuçları, sahibin e-postası hiç.
- Kötüye kullanım: davet başına cevap tavanı (ör. 100), görünmez bal küpü alanı, uzunluk sınırları; Ozan cevap siler, daveti kapatır, linki yeniler.
- Cevap verenin adı kişisel veri: sayfada "Adın yalnız plan sahibine ve (ayara göre) diğer davetlilere görünür" notu; plan silinince cevaplar da silinir.
- Telegram webhook'u gizli başlıkla; cron'lar mevcut `CRON_SECRET` ile.

## Maliyet

| Kalem | Birim | Ücretsiz kota | Beklenen kullanım |
|---|---|---|---|
| Resend e-posta | e-posta | ayda 3.000, günde 100 [R1][R2] | ayda onlarca (tahmin — bugün Ozan'ın planı yok; dilim 2'den sonra ölçülür) |
| Telegram | mesaj | ücretsiz; sohbet başına ~1/sn, grupta 20/dk [T-Q] | ayda onlarca |
| WhatsApp linki | — | ücretsiz | — |
| Vercel cron | kısa çağrı | planın dahil kullanımı (bu tasarım için ölçülmedi) | 15 dakikada bir ≈ ayda 2.900 çağrı |
| Claude | token | yok | Bildirimler şablonla üretilir, Claude çağırmaz; yalnız asistanla yapılan `send_plan` / `invite_to_plan` turları normal sohbet maliyeti |

## Dilim 1 — durum (25.11.2026)

**Yapılan (v1.57.0, dalda; main'de değil):** `notification_channels`, `channel_link_tokens`, `notifications` ve `notification_claim` ([[../02-backend/schema/notifications]]); Resend ve Telegram göndericileri; outbox (`deliver`: önce kayıt, sonra kilit, gönderim, sonuç); Telegram bağlama (webhook, `/start <anahtar>`, engelleme / engel kaldırma); e-posta onayı; Ayarlar → Notifications (sekme adreste, `?tab=`); plan menüsünde *Send to me…*; asistanın `send_plan` aracı, onay kartı ve talimat satırı. Akış: [[../05-flows/notifications-flow]], yollar: [[../02-backend/api-routes/notifications]].

**Tasarımdan sapmalar (gerekçeli):**

1. **Tek anahtar tablosu** (`channel_link_tokens`, yukarıda).
2. **E-posta onayı bir sayfa + düğme** (`/confirm-email`): linki açmak bir şey değiştirmez, *Confirm address* değiştirir. Posta tarayıcıları (Outlook Safe Links, kurumsal filtreler) linkleri kendiliğinden açar; GET ile onay, kimsenin okumadığı bir adresi onaylayabilirdi. İkinci basış ve aynı adrese ikinci link "onaylandı" der.
3. **Sahip kapısı:** bütün bildirim yolları `ASSISTANT_OWNER_EMAILS` listesine bakıyor (`notifyContext`) — karar 7'nin ("v1'de yalnız sana") koda dökülmüş hâli. Sahip olmayan bir hesap uygulamaya e-posta ya da Telegram mesajı gönderttiremez; Ayarlar ve gönderim penceresi bunu söyler.
4. **Kilidi düşmüş gönderim yeniden alınır:** gönderici kilitledikten sonra ölürse satır `sending` kalırdı; artık kilidi (60 sn) dolunca yeniden alınır. Kayıp hatırlatma, nadir bir ikinci kopyadan kötü; e-posta zaten iki kez gidemez (Resend'in idempotency anahtarı, 24 saat).
5. **React Email yerine tipli metin şablonları:** üç kısa mesaj, deterministik, offline test ediliyor; iki paket ve bir render adımı eklemeye değmedi. Dilim 3'ün davet e-postaları büyürse yeniden bakılır.
6. **Telegram'ın tekrar gönderdiği güncelleme:** `update_id` saklamak yerine asıl etkisi olan yol idempotent — aynı sohbet aynı linkle tekrar gelirse "Bağlandı" der; engelleme güncellemeleri zaten idempotent, diğer mesajlara giden tek satırlık cevabın tekrarı zararsız.
7. **`send_plan` hiçbir kanala gidemezse hata sonucu döner:** model "gönderildi" diyemez, kart *Couldn't send* ve nedenini gösterir; kısmi başarıda kart nereye gittiğini ve neyin gitmediğini yazar.
8. **Telegram mesajında notlar kısaltılır** (plan 500, gün 300, durak 200 karakter): plan notu 5.000 karaktere kadar çıkabiliyor, mesaj sınırı 4.096.
9. **Kayıttaki e-posta kopyasında onay anahtarı gizlenir** (e-posta testine hazırlanırken bulundu, v1.57.3): gönderim kaydı onay e-postasının metnini linkiyle saklıyordu — anahtar yalnız hash'iyle saklanır ilkesini delen bir hataydı. Artık kopyada `token=•••` yazıyor; e-postanın kendisi tam gider.
10. **Gönderen adı koddan:** `EMAIL_FROM` yalnız adres olduğunda (`hello@mappy.site`) e-posta "Map Organiser" adıyla gider.
11. **Webhook kaydını uygulama yapar** (Ozan'ın seçimi, 26.11.2026): production'da her "Connect Telegram"de sunucu önce `getMe` ile botun kullanıcı adını Vercel'dekiyle karşılaştırır, sonra `setWebhook` ile adresi ve sırrı kaydeder. Bot anahtarı ve sır yalnız BotFather'da ve Vercel'de durur; elle komut yok. Preview ve yerelde atlanır (karar 13).

**Doğrulama:** `npm run check:notify` 107 kontrol (Türkçe metinler ve kaçış, Telegram sınırı, bot güncellemeleri, anahtarlar, outbox, iki kanalın bağlanması, gönderim, `send_plan`'ın cevabı ve kartı); `npm run check:agent` 165 kontrol; migration'ın geri alınan deneme çalıştırması (sonuçlar şema dokümanında); `next build`; dev sunucusunda `/confirm-email` oturumsuz açılıyor (telefonda da), webhook bot ayarlı değilken 404. Henüz denenmeyen: gerçek e-posta ve Telegram gönderimi (aşağıdaki adımlardan sonra).

**Açık adımlar (sırayla):**
1. ~~Migration'ın uygulanması~~ — uygulandı (25.11.2026, sürüm 20261125203540); `npm run check:notify:db` 15/15. Ek: `notifications.plan_id` indeksi (Supabase'in performans uyarısı) — Ozan'ın onayıyla uygulandı (25.11.2026, sürüm 20261125224149); uyarı kalktı.
2. Ozan'ın dashboard adımları (aşağıda): Resend alanı ve anahtarı → Vercel + worktree `.env.local`; BotFather → Vercel Production.
3. ~~E-posta uçtan uca~~ — yerelde test hesabıyla, Chrome'da, Ozan'ın Gmail'ine denendi (25.11.2026): onay, test e-postası ve bir planın özeti gitti; üç kayıt `sent`. Üç e-posta da Ozan'ın Gmail'ine geldi. Ayrıntı: [[../05-flows/notifications-flow#Checks]].
4. Telegram: yalnız production'da (karar 13). Bot ve Vercel değişkenleri hazır (26.11.2026); main'e merge ve deploy'dan sonra production'da Ayarlar → Connect Telegram (webhook'u uygulama kaydeder), sonra test.

## Dilimler ve geçiş yolu

Bütün şema değişiklikleri **eklemeli** (yeni tablolar, `profiles.time_zone`); çalışan hiçbir kodun bağlı olduğu yapı değişmiyor — geçiş ve sonradan söküm adımı yok.

1. **Kanallar ve "Bana gönder"** *(v1.57.0, dalda — yukarıda)*: `notification_channels`, `channel_link_tokens`, `notifications`; Resend ve Telegram göndericileri; Telegram bağlama (webhook); e-posta onayı; Ayarlar → Bildirimler; plan sayfasında *Bana gönder*; `send_plan`.
2. **Otomatik gönderimler:** `profiles.time_zone`, `notification_settings`; `/api/cron/notify`; hatırlatmalar ve haftalık özet.
3. **Davet ve RSVP:** `plan_invitations`, `plan_rsvps`; `/invite/<token>` (sunucuda render, OG görseli, `noindex`); paylaşım; cevap bildirimi; `invite_to_plan`; `get_plans`'e cevaplar.
4. **Takvim:** `.ics` (sahip ve davet sayfası).

**Regresyon listesi:**
- Ayarlar sayfasına yeni sekme (sekme çubuğu mobilde taşmamalı).
- `proxy`: herkese açık yeni yollar — `/invite/`, `/api/invite/`, `/api/telegram/webhook`; bugünkü `/shared/` ve `/api/cron/` istisnaları aynen.
- Plan görünümü bileşeni `/shared/<slug>` sayfasından ayrılıp davet sayfasıyla paylaşılırsa: paylaşılan liste / plan / mekan sayfaları ayrıca denenir.
- `next.config.ts`: `htmlLimitedBots`'a `TelegramBot` — bütün sayfaların metadata akışını o bot için değiştirir (başka etkisi beklenmez).
- MCP ve asistan araç listesi büyür: sabit istem uzar (önbellek bir kez yeniden yazılır); `npm run check:agent` ve eval'in araç beklentileri.
- `vercel.json`'a yeni cron.
- `/shared` sayfalarına `noindex`: arama motorundan gelen ziyaret yok sayılır (bugün de beklenen bu).

## Ozan'ın dashboard adımları

- **Resend:** hesap; `mail.maporganiser.com` alanını ekle (bölge seçimi kalıcı); Resend'in ürettiği DNS kayıtlarını DNS sağlayıcısına gir (Cloudflare ise proxy kapalı); `_dmarc.maporganiser.com` TXT `v=DMARC1; p=none; rua=mailto:…`; API anahtarı → Vercel `RESEND_API_KEY`.
- **Telegram:** ~~@BotFather `/newbot`; üç değişken Vercel'e (yalnız Production)~~ — yapıldı (26.11.2026): bot **Mappy**, `@mappysitebot`; `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` Production'da. Webhook kaydını uygulama kendisi yapar (sapma 11) — deploy'dan sonra production'da Ayarlar → Connect Telegram yeterli.
- **Resend gönderen:** Vercel `EMAIL_FROM` = `hello@mappy.site` (Production + Preview; uygulama "Map Organiser" adını kendisi ekler). Yerelde ana klasörün ve worktree'nin `.env.local`'ında var (25.11.2026). `mappy.site` DMARC kaydı da var (TXT `_dmarc` = `v=DMARC1; p=none;`).
- Uygulamada: e-posta onay linkine tıkla, Telegram'ı bağla.

## Değerlendirilip seçilmeyenler

- **Resend'in `scheduled_at`'i ile hatırlatma:** hatırlatmanın durumu iki yerde tutulur, plan değişince eşitlemek gerekir, 30 gün sınırı var [R10] → kendi kaydımız + cron.
- **Postmark, Amazon SES:** yukarıda.
- **WhatsApp Business API:** işletme hesabı, en fazla 8 katılımcı, düğmeli mesaj yok → yalnız link (karar 6).
- **Yalnız isimle kimlik:** hiçbir yaygın üründe yok [X1–X4]; cihaz anahtarı + Ozan'ın düzeltmesi ekleniyor.
- **Misafiri SMS / e-postayla doğrulamak:** bir arkadaş grubu için ağır, maliyetli.
- **Davet için `shared_links`'i genişletmek:** polimorfik, salt okunur, kısa anahtar → ayrı davet varlığı.
- **Rehber ve gruplar v1'de:** grup zaten WhatsApp'ta; ihtiyaç doğunca eklenir (karar 4).
- **Durak başına takvim etkinliği:** takvimi doldurur → gün başına.
- **"Google Takvim'e ekle" linki:** Google belgelemiyor [C5] → kısayol; istenirse ek seçenek (karar 10).
- **Telegram `getUpdates`, MarkdownV2:** yukarıda.
- **Web Push (PWA bildirimi):** iOS'ta uygulamanın ana ekrana eklenmesini ister; karar 6'da kanal Telegram → ileride ek kanal olabilir.
- **Bildirim metnini Claude'a yazdırmak:** maliyet ve tutarsızlık → şablon.

## Kararlar (Ozan'a sorular)

| # | Soru | Önerim |
|---|---|---|
| 1 | Dilim sırası | 1 → 2 → 3 → 4 (karar 6'da otomatik bildirim önde; davet "ileride") |
| 2 | Telegram v1'de yalnız bildirim mi, sohbet kapısı da mı? (açık soru 3) | Yalnız bildirim; sohbet kapısı ayrı dilim |
| 3 | Davet modeli | Grup için tek açık link + cihaz anahtarı + Ozan'ın elle eklemesi; kişiye özel link sonra |
| 4 | Rehber ve gruplar (açık soru 4) | v1'de yok; grup WhatsApp'ta |
| 5 | Davet sayfasında adres ve harita | Mekan adı ve semt her zaman; tam adres ve pinler cevaptan sonra |
| 6 | Cevap seçenekleri ve liste | Geliyorum / Belki / Gelmiyorum, +N en çok 3, not; katılanlar listesi cevap verince görünür |
| 7 | E-posta | `mail.maporganiser.com`, gönderen "Map Organiser"; bölge eu-west-1 (veri yine ABD'de); v1'de yalnız sana, arkadaşlara e-posta yok. **Uygulamada (Ozan, 25.11.2026):** bunun için alınan `mappy.site` alanı, gönderen adresi `hello@mappy.site` ("Map Organiser" adıyla) |
| 8 | Hatırlatma ve özet varsayılanları | Önceki akşam 18:00 + plan sabahı 08:00 (planın yerel saati); haftalık özet pazartesi 08:00; ikisi de e-posta + Telegram |
| 9 | Davete cevap gelince | Telegram (anında); e-posta yalnız haftalık özette |
| 10 | Takvim | Gün başına `.ics`; Google linki yok |
| 11 | Kendi RSVP'miz mi, WhatsApp Events mi? | Kendi RSVP'miz (plan, harita, takvim bizde) |
| 12 | Mevcut paylaşımın eksikleri | `/shared` sayfalarına `noindex` ve yeni paylaşım linklerinde uzun anahtar — dilim 3'te |
| 13 | Preview'da Telegram | Yalnız production'da; gerekirse ikinci test botu |
| 14 | Dil | Davet sayfası, e-posta ve Telegram mesajları Türkçe; uygulamanın kendi arayüzü İngilizce kalır |

## Kaynaklar (25.11.2026'da açıldı)

- **E-posta:** R1 https://resend.com/pricing · R2 https://resend.com/docs/knowledge-base/account-quotas-and-limits · R4 https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying · R5 https://resend.com/docs/dashboard/domains/custom-return-path · R6 https://resend.com/docs/add-a-domain · R7 https://resend.com/docs/dashboard/domains/dmarc · R8 https://resend.com/docs/api-reference/emails/send-email · R9 https://resend.com/docs/dashboard/emails/idempotency-keys · R10 https://resend.com/docs/dashboard/emails/schedule-email · R15 https://resend.com/docs/dashboard/webhooks/event-types · R16 https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests · R17 https://resend.com/docs/dashboard/emails/email-suppressions · R18 https://resend.com/docs/knowledge-base/warming-up · R22 https://resend.com/docs/dashboard/domains/regions · R24 https://resend.com/security/gdpr · P1 https://postmarkapp.com/pricing · P4 https://postmarkapp.com/support/article/what-is-an-idempotency-key · P6 https://postmarkapp.com/developer/webhooks/webhooks-overview · S2 https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- **Telegram** (Bot API 10.5, 22.11.2026): T-A https://core.telegram.org/bots/api · T-F https://core.telegram.org/bots/features · T-Q https://core.telegram.org/bots/faq · T-B https://core.telegram.org/bots
- **WhatsApp ve önizleme:** W1 https://faq.whatsapp.com/5913398998672934 · W2 https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Navigator.share.json · W3 https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share · W4 https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/ · W5 https://faq.whatsapp.com/445453537819972 · W6 https://blog.whatsapp.com/whatsapp-events-brings-people-together-beyond-the-group-chat · N1–N3 `node_modules/next/dist/docs/01-app/03-api-reference/` (`opengraph-image.md`, `image-response.md`, `generate-metadata.md`) ve `node_modules/next/dist/shared/lib/router/utils/html-bots.js`
- **Takvim:** C1 https://www.rfc-editor.org/rfc/rfc5545 · C2 https://www.rfc-editor.org/rfc/rfc5546 · C3 https://support.google.com/calendar/answer/37100 · C4 https://support.microsoft.com/en-us/office/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web-cff1429c-5af6-41ec-a5b4-74f2c278e98c · C5 https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/main/services/google.md (topluluk dokümanı)
- **RSVP örnekleri:** X1 Partiful https://help.partiful.com/hc/en-us/articles/34230743189787 · X2 Luma https://help.luma.com/p/event-registration-process · X3 Apple Invites https://support.apple.com/guide/apple-invites/invite-guests-dev851dd16db/ios · X4 Google Calendar API https://developers.google.com/workspace/calendar/api/v3/reference/events
- **Gizlilik:** O1 https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html · O2 https://www.w3.org/TR/capability-urls/ · G1 https://developers.google.com/search/docs/crawling-indexing/block-indexing
