# Map Organiser - Test Plan v1

## Genel Bilgi
Bu dokuman, Map Organiser uygulamasinin kullanici testi icin hazirlanmis senaryolari icerir. Her servis icin ayri test gruplari vardir. Testler production ortaminda (map-organiser.vercel.app) calistirilabilir.

**Onkosullar:**
- Aktif bir hesap (email veya Google ile kayit)
- En az 1 kaydedilmis mekan
- En az 1 kategori, tag ve liste olusturulmus

---

## Service 1: Auth Service Tests

### T1.1: Email ile Kayit
| Adim | Beklenen Sonuc |
|------|----------------|
| /signup sayfasina git | Kayit formu gorunur |
| Ad, email, sifre gir → "Create account" | Basarili → /map'e yonlendirilir |
| Header'da kullanici avatar'i gorulur | Dogru isim/email bilgisi |

### T1.2: Google ile Giris
| Adim | Beklenen Sonuc |
|------|----------------|
| /login → "Continue with Google" | Google consent ekranina yonlendirilir |
| Google hesabi sec | /auth/callback → /map'e yonlendirilir |
| Profil olusturulur | Settings'te isim ve avatar gorulur |

### T1.3: Oturum Korunmasi
| Adim | Beklenen Sonuc |
|------|----------------|
| Giris yapmadan /map'e git | /login'e yonlendirilir |
| Giris yap → /login'e git | /map'e yonlendirilir |
| Sayfayi yenile (F5) | Oturum korunur, /map'te kalir |

### T1.4: Cikis
| Adim | Beklenen Sonuc |
|------|----------------|
| Avatar → "Sign out" | /login'e yonlendirilir |
| /map'e gitmeyi dene | /login'e yonlendirilir |

---

## Service 2: Places Service Tests

### T2.1: Link ile Mekan Ekleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Map sayfasinda + butonu tikla | Add Place dialog acilir |
| Google Maps linki yapistir: `https://maps.app.goo.gl/H2AGd1EzDCUbfb9F8` | |
| Link ikonuna tikla | Loading → mekan bilgileri gelir |
| Foto, isim, adres, rating, saatler gorulur | Dogru mekan bilgisi |
| "Save Place" tikla | Toast: "[Mekan adi] saved!" |
| Haritada marker gorulur | Dogru konumda marker |

### T2.2: Kategori Otomatik Atama
| Adim | Beklenen Sonuc |
|------|----------------|
| Bir restoran linki yapistir | Kategori otomatik "Restaurant" olarak secilir |
| Bir kafe linki yapistir | Kategori otomatik "Cafe" olarak secilir |
| Bir bar/pub linki yapistir | Kategori otomatik "Bar & Nightlife" olarak secilir |
| Kategori dropdown'unda isim gorulur (UUID degil) | "Restaurant" yazisi gorulur |

### T2.3: Ekleme Sirasinda Detaylar
| Adim | Beklenen Sonuc |
|------|----------------|
| Link parse edildikten sonra: | |
| Visit status = "Want to Go" secili | Default olarak secili gelir |
| Tag input'a yaz + Enter | Yeni tag olusturulur ve eklenir |
| Liste sec (checkbox) | Checkmark gorunur |
| Rating yildizlarina tikla | Yildizlar dolar |
| Not yaz | Text area'ya girilir |
| Kaydet | Tum bilgiler kaydedilir |

### T2.4: Mekan Silme
| Adim | Beklenen Sonuc |
|------|----------------|
| Place detail sayfasinda "Delete" tikla | Onay dialog'u cikar |
| "OK" tikla | Toast: "Place deleted" → /places'a donulur |
| Places listesinde mekan yok | Aninda kaybolur (cache invalidate) |

### T2.5: Mekan Detayi Goruntuleme
| Adim | Beklenen Sonuc |
|------|----------------|
| /places/[id] sayfasina git | |
| Foto gorulur | Google'dan cekilmis foto |
| Adres gorulur | Tam adres metni |
| Kategori badge'i gorulur | Renkli badge ile kategori adi |
| Google rating gorulur | Yildiz + puan + yorum sayisi |
| Saatler gorulur | Gunluk calisma saatleri |
| Yorumlar gorulur | En az 1 Google yorumu |
| "View on Google Maps" linki gorulur | Tiklaninca Google Maps acilir |
| Google Maps linki calisir | Dogru mekana gider |

### T2.6: Rating Duzenleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Place detail'da yildizlara tikla (orn: 4 yildiz) | 4 yildiz dolar, kaydedilir |
| Sayfayi yenile | 4 yildiz hala dolu |
| Ayni yildiza tekrar tikla | Rating temizlenir (0 yildiz) |

---

## Service 3: Google Integration Tests

### T3.1: Short Link Parse
| Adim | Beklenen Sonuc |
|------|----------------|
| `maps.app.goo.gl/xxx` linki yapistir | Redirect resolve → dogru mekan |
| Link ikonuna tikla | Mekan bilgileri gelir |
| Isim, adres, ulke dogru | Google'daki bilgiyle eslesir |

### T3.2: FTid Formatli Link
| Adim | Beklenen Sonuc |
|------|----------------|
| CSV'deki formatta link yapistir: `https://www.google.com/maps/place/Los+Compadres/data=!4m2!3m1!1s0x48761da...` | |
| Parse et | S2 cell decode → dogru bolgede arama → Londra'daki mekan |
| ABD'deki yanlis mekani dondurmuyor | Konum bias ile dogru mekan |

### T3.3: Google Reviews Refresh
| Adim | Beklenen Sonuc |
|------|----------------|
| Place detail'da "Refresh" tikla | Loading spinner gosterilir |
| Bekleme | Yorumlar guncellenir |
| Yeni yorumlar gorulur | Google'dan taze veri |

### T3.4: Google Maps URL Kaydedilmesi
| Adim | Beklenen Sonuc |
|------|----------------|
| Yeni mekan ekle | |
| Place detail'da "View on Google Maps" linki var | Link tiklaninca dogru mekana gider |
| Map popup'inda "Maps ↗" linki var | Tiklaninca Google Maps acilir |
| Map detail panelinde "Google Maps" butonu var | Tiklaninca dogru mekana gider |

---

## Service 4: Category Service Tests

### T4.1: Kategorileri Goruntuleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Settings → Categories tab | 12 default kategori listelenir |
| Her kategoride renk, isim, "default" badge gorulur | Dogru renk ve isimler |

### T4.2: Yeni Kategori Olusturma
| Adim | Beklenen Sonuc |
|------|----------------|
| Settings → Kategori adi gir + renk sec → + tikla | Yeni kategori eklenir |
| Filter panel'de yeni kategori gorulur | Filtre seceneklerinde mevcut |
| Mekan eklerken yeni kategori secilebilir | Dropdown'da gorulur |

### T4.3: Kategori Silme
| Adim | Beklenen Sonuc |
|------|----------------|
| Settings → default olmayan kategoride cop ikonu tikla | Onay dialog'u |
| "OK" tikla | Kategori silinir |
| Ilgili mekanlarin kategorisi "null" olur | Kategori badge kaybolur |
| Default kategori silinemiyor | Cop ikonu gosterilmez |

### T4.4: Inline Kategori Olusturma
| Adim | Beklenen Sonuc |
|------|----------------|
| Add Place dialog → Category yaninda "+ New" | Popover acilir |
| Isim + renk sec → "Create" | Kategori olusturulur ve secilir |
| Dropdown'da yeni kategori gorulur | Hemen mevcut |

---

## Service 5: Tag Service Tests

### T5.1: Tag Olusturma (Settings)
| Adim | Beklenen Sonuc |
|------|----------------|
| Settings → Tags tab → isim gir → + tikla | Tag olusturulur |
| Tag listesinde gorulur | Isim ve silme ikonu |

### T5.2: Tag Olusturma (Inline)
| Adim | Beklenen Sonuc |
|------|----------------|
| Add Place dialog → Tags input'a yaz | Oneriler gorulur |
| Enter'a bas (yeni tag) | "+ Create 'xxx'" → tag olusturulur |
| Mevcut tag secimi | Oneriyi tikla → eklenir |
| Tag silme (X ikonu) | Tag listeden kalkar |

### T5.3: Tag Filtreleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Filter panel → Tags bolumunde tag tikla | Tag secilir (yesil arka plan) |
| Sadece o tag'li mekanlar gorulur | Liste filtrelenir |
| Ayni tag'a tekrar tikla | Filtre kalkar, tum mekanlar gorulur |
| Tag seciliyken arka plani gorulur (kaybolmuyor) | Yesil (emerald) arka plan |

### T5.4: Place Detail'de Tag Yonetimi
| Adim | Beklenen Sonuc |
|------|----------------|
| Place detail → Tags → "+ Add Tag" | Popover acilir, InlineTagInput gosterilir |
| Tag sec veya yeni olustur | Tag eklenir, hemen gorulur |

---

## Service 6: List Service Tests

### T6.1: Liste Olusturma
| Adim | Beklenen Sonuc |
|------|----------------|
| /lists → "+ New List" | Dialog acilir |
| Isim gir → "Create List" | Liste olusturulur, grid'de gorulur |
| Liste card'inda: isim, 0 places | Dogru bilgi |

### T6.2: Listeye Mekan Ekleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Place detail → Lists → "+ Add to list" | Popover acilir |
| Liste tikla (checkbox) | Checkmark gorulur |
| Place detail'de liste badge gorulur | Eklenen listenin adi gorulur |
| /lists sayfasinda place count guncellenir | "1 place" yazar |

### T6.3: Liste Detayi
| Adim | Beklenen Sonuc |
|------|----------------|
| /lists/[id] sayfasina git | Listedeki mekanlar gorulur |
| Grid/Map toggle | Harita gorunumune gecis yapilir |
| Haritada sadece listedeki mekanlar | Diger mekanlar gorulmez |

### T6.4: Liste Filtreleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Filter panel → List dropdown → liste sec | Sadece o listedeki mekanlar |
| "All lists" sec | Tum mekanlar gorulur |

---

## Service 7: Map Service Tests

### T7.1: Harita Yuklenmesi
| Adim | Beklenen Sonuc |
|------|----------------|
| /map sayfasina git | Mapbox haritasi yuklenir |
| Tile'lar gorulur | Ulkeler, sehirler, yollar |
| Zoom kontrolleri calisir | +/- butonlari ile zoom |

### T7.2: Marker'lar
| Adim | Beklenen Sonuc |
|------|----------------|
| Mekanlar marker olarak gorulur | Kategori renginde daire |
| Visit status stroke'u gorulur | Visited=yesil, favorite=kirmizi, booked=mavi |
| Zoom out → cluster'lar olusur | Sayi gosterilir |
| Cluster'a tikla → zoom in | Alt marker'lar gorunur |

### T7.3: Popup
| Adim | Beklenen Sonuc |
|------|----------------|
| Marker'a tikla | Popup acilir: isim, adres, rating |
| "View details →" tikla | Sag panelde detay acilir (haritadan ayrilmaz) |
| "Maps ↗" tikla | Yeni sekmede Google Maps acilir |
| Baska marker'a tikla | Eski popup kapanir, yeni popup acilir |

### T7.4: Detail Panel (Slide-in)
| Adim | Beklenen Sonuc |
|------|----------------|
| "View details →" tikla | Sag taraftan panel slide eder |
| Panel icerigi: foto, adres, badges, rating, saatler, yorumlar | Dogru bilgiler |
| X butonuna tikla | Panel kapanir |
| "Full details" butonu | /places/[id] sayfasina gider |
| Visit status degistir | Haritadaki marker stroke rengi degisir |

### T7.5: Harita Filtreleme (Desktop)
| Adim | Beklenen Sonuc |
|------|----------------|
| Sol sidebar'da filtreler gorulur | FilterPanel render edilir |
| Kategori tikla → sadece o kategorinin marker'lari | Diger marker'lar kaybolur |
| Status filtresi → "Visited" sec | Sadece visited mekanlar |
| Temizle → tum mekanlar gorulur | Clear butonu ile |

### T7.6: Harita Filtreleme (Mobil)
| Adim | Beklenen Sonuc |
|------|----------------|
| "Filters" butonuna tikla | Bottom sheet acilir (max %65 yukseklik) |
| Filtre sec | Sheet kapanir, harita filtrelenir |
| "Done" butonu | Sheet kapanir |

---

## Service 8: Import Service Tests

### T8.1: CSV Import
| Adim | Beklenen Sonuc |
|------|----------------|
| /import sayfasina git | Drag & drop alani gorulur |
| CSV dosyasi yukle | Dosya adi gosterilir |
| "Import" tikla | Loading spinner |
| Sonuc gosterilir | "X imported, Y enriched, Z skipped out of N" |
| Skipped mekanlar tabloda gorulur | Isim, sebep, Maps linki |

### T8.2: Import Zenginlestirme
| Adim | Beklenen Sonuc |
|------|----------------|
| CSV'deki mekanlar Google Maps URL iceriyorsa | enriched sayisi > 0 |
| Import edilen mekanlarda foto gorulur | Google'dan cekilmis |
| Kategoriler otomatik atanmis | "Restaurant", "Cafe" vb. |
| Duplikat mekanlar skip edilmis | "Already exists" sebebi |

### T8.3: GeoJSON Import
| Adim | Beklenen Sonuc |
|------|----------------|
| GeoJSON dosyasi yukle | Parse edilir |
| Import basarili | Mekanlar eklenir |

---

## Service 9: Bulk Operations Tests

### T9.1: Mekan Secimi
| Adim | Beklenen Sonuc |
|------|----------------|
| Places grid'de card'in sol ustundeki checkbox'a tikla | Card secilir (yesil cerceve) |
| Ikinci card sec | 2 secili, bulk bar gorulur |
| "Select All" tikla | Tum card'lar secilir |
| "Deselect All" tikla | Secim temizlenir, bulk bar kaybolur |
| Checkbox tiklamak card'a navigate etmiyor | Sadece secer/desecer |

### T9.2: Toplu Kategori Degistirme
| Adim | Beklenen Sonuc |
|------|----------------|
| 3 mekan sec | Bulk bar gorulur |
| Category dropdown → "Restaurant" sec | Toast: "Updated 3 places" |
| Tum 3 mekanin kategorisi "Restaurant" olur | Card'larda gorulur |

### T9.3: Toplu Tag Ekleme
| Adim | Beklenen Sonuc |
|------|----------------|
| 2 mekan sec | Bulk bar gorulur |
| Tag dropdown → tag sec | Toast: "Updated 2 places" |
| Her iki mekanda tag gorulur | Card'lardaki tag pill'lerinde |

### T9.4: Toplu Listeye Ekleme
| Adim | Beklenen Sonuc |
|------|----------------|
| 3 mekan sec | |
| List dropdown → liste sec | Toast: "Updated 3 places" |
| /lists/[id]'de 3 mekan gorulur | Listeye eklenmis |

### T9.5: Toplu Status Degistirme
| Adim | Beklenen Sonuc |
|------|----------------|
| 2 mekan sec | |
| Status dropdown → "Visited" sec | Toast: "Updated 2 places" |
| Her iki mekanda "Visited" badge gorulur | Card'larda gorulur |

### T9.6: Toplu Silme
| Adim | Beklenen Sonuc |
|------|----------------|
| 2 mekan sec | |
| "Delete" kirmizi buton tikla | confirm() dialog'u acilir |
| "OK" tikla | Toast: "Deleted 2 places" |
| Mekanlar listeden kaybolur | Aninda guncellenir |
| "Cancel" tikla | Hicbir sey silinmez |

---

## Service 10: Filter Service Tests

### T10.1: Ulke Filtresi
| Adim | Beklenen Sonuc |
|------|----------------|
| Country dropdown → "Turkey" sec | Sadece Turkiye mekanlari gorulur |
| Sehir dropdown gorulur | Turkiye sehirleri listelenir |
| Sehir sec (orn: Istanbul) | Sadece Istanbul mekanlari |
| X butonuna tikla (country temizle) | Tum mekanlar gorulur |
| "All countries" secimi tekrar yapilabilir | Dropdown'dan secilebilir |

### T10.2: Kategori Filtresi
| Adim | Beklenen Sonuc |
|------|----------------|
| "Restaurant" tikla | Pill yesil olur, sadece restoranlar |
| "Restaurant" tekrar tikla | Filtre kalkar, tum mekanlar |
| "Cafe" tikla | Sadece kafeler gorulur |

### T10.3: Visit Status Filtresi
| Adim | Beklenen Sonuc |
|------|----------------|
| "Visited" tikla | Sadece visited mekanlar |
| "Want to Go" tikla | Sadece want_to_go mekanlar |
| "All" tikla | Tum mekanlar |

### T10.4: Rating Filtresi
| Adim | Beklenen Sonuc |
|------|----------------|
| My rating → 4 yildiz tikla | Sadece 4+ puanli mekanlar (kullanici puani) |
| Google rating → 4 yildiz tikla | Sadece Google 4+ mekanlar |
| 4 yildiza tekrar tikla | Filtre kalkar |

### T10.5: Arama
| Adim | Beklenen Sonuc |
|------|----------------|
| Search kutusuna "coffee" yaz | Isim/adres/notlarda "coffee" gecen mekanlar |
| Arama temizle | Tum mekanlar gorulur |

### T10.6: Coklu Filtre
| Adim | Beklenen Sonuc |
|------|----------------|
| Country=Turkey + Category=Restaurant | Turkiye'deki restoranlar |
| + Status=Visited | Turkiye'deki ziyaret edilen restoranlar |
| URL'de parametreler gorulur | `?country=Turkey&category=xxx&status=visited` |
| Sayfayi yenile | Filtreler korunur (URL'den okunur) |
| "Clear" tikla | Tum filtreler temizlenir |

---

## Cross-Service Tests

### T11.1: End-to-End Mekan Ekleme + Filtreleme
| Adim | Beklenen Sonuc |
|------|----------------|
| Google Maps'ten bir restoran linki kopyala | |
| + butonu → linki yapistir → parse | Mekan bilgileri gelir, kategori="Restaurant" |
| Tag ekle: "fine-dining" | Tag olusturulur ve eklenir |
| Liste sec: "Favorites" | Listeye eklenir |
| Status: "Visited" | Visit status secilir |
| Kaydet | Tum bilgilerle kaydedilir |
| Haritada gorulur | Yesil stroke (visited) + kirmizi renk (restaurant) |
| Category filter → "Restaurant" | Mekan gorulur |
| Tag filter → "fine-dining" | Mekan gorulur |
| List filter → "Favorites" | Mekan gorulur |
| Status filter → "Visited" | Mekan gorulur |
| Status filter → "Want to Go" | Mekan gorulmez |

### T11.2: Mobil Responsive
| Adim | Beklenen Sonuc |
|------|----------------|
| Telefonda sayfayi ac | Alt tab bar gorulur (Map/Places/Lists) |
| Map tab → filtre butonu | Bottom sheet acilir |
| Bottom sheet max %65 yukseklik | Ekrani tamamen kaplamamali |
| "Done" butonu | Sheet kapanir |
| + FAB butonu → Add Place | Full-screen dialog acilir |
| Places tab → card grid | Tek kolonlu mobil layout |

### T11.3: PWA
| Adim | Beklenen Sonuc |
|------|----------------|
| Mobilde "Ana Ekrana Ekle" | PWA olarak yuklenebilir |
| PWA olarak ac | Standalone gorunum, no browser bar |
| Google Maps'ten bir mekani paylas → Map Organiser sec | Paylas hedefi olarak gorulur |

---

## Bilinen Sinirlamalar

1. **Google API Rate Limit:** Import sirasinda 200ms delay. Buyuk importlarda (1000+ mekan) timeout olabilir.
2. **JSONB Filtreleme:** Google rating ve review text filtreleme JS tarafinda yapilir (DB'de JSONB array icinde ilike yapilamiyor).
3. **FTid Hassasiyeti:** S2 cell decode ~3km hassasiyet. Ayni sehirde cok subeli zincirlerde yanlis sube bulunabilir.
4. **Base UI Select:** Native `<select>` kullaniliyor cunku Base UI Select guvenilir calismadi.
5. **Offline:** PWA manifest var ama offline cache stratejisi henuz implement edilmedi.
