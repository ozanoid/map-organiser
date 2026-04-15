# Map Organiser - Test Plan v2

> **v2 Güncelleme:** 2026-04-16
> **Önceki:** test-plan_v1.md (2026-04-11)
> **Yeni test grupları:** DataForSEO (T3b), Sort (T10b), Dark Mode (T14), Trip Planner (T11), Sharing (T12), Stats (T13), Batch Import (T8b), Custom Markers (T7b)

---

v1 test planı (`test-plan_v1.md`) hâlâ geçerlidir. Bu doküman sadece v2'de eklenen test senaryolarını kapsar.

---

## T3b: DataForSEO Integration Tests

### T3b.1: Tekli mekan ekleme (DataForSEO path)
1. Settings'ten Google Places'ı devre dışı bırak
2. Google Maps linki yapıştır
3. **Beklenen:** DataForSEO ile enrich edilmiş preview (isim, adres, rating, fotoğraf)
4. Kaydet → mekan DB'de `provider: "dataforseo"` ile
5. Background: info enrichment (extended data) + reviews (polling)

### T3b.2: CID bazlı lookup
1. `?cid=123456` içeren URL yapıştır
2. **Beklenen:** CID ile direkt lookup, doğru mekan bulunur

### T3b.3: FTid bazlı lookup
1. FTid hex içeren URL yapıştır
2. **Beklenen:** FTid'den CID extract → DataForSEO lookup

### T3b.4: Google fallback
1. Google Places enabled + API key var
2. Link yapıştır → Google path dene → başarısız
3. **Beklenen:** DataForSEO'ya fallback

---

## T7b: Custom Marker Tests

### T7b.1: Icon markers
1. Settings > Appearance > Marker Style = "Category icons"
2. Map sayfasına git
3. **Beklenen:** Her mekan renkli daire + beyaz Lucide ikon

### T7b.2: Dot markers
1. Marker Style = "Simple dots"
2. **Beklenen:** Eski stil renkli daireler, visit status stroke

### T7b.3: Kategori ikon ataması
1. Settings > Categories > yeni kategori oluştur
2. İkon grid'den ikon seç
3. **Beklenen:** Kategori listesinde ikon+renk, haritada doğru ikon

### T7b.4: Style değişiminde marker re-register
1. Dark mode'a geç (harita stili değişir)
2. **Beklenen:** Marker ikonları dark haritada da görünür

---

## T8b: Batch Import Tests

### T8b.1: Normal import
1. CSV dosyası seç → Import Options görünsün
2. "Start Import" tıkla
3. **Beklenen:** Progress bar her 3 mekan sonrası ilerler, mekan status listesi güncellenir
4. Tamamlanınca result card + "Enriching reviews in background..."

### T8b.2: Import options
1. Visit Status: "Want to Go" seç
2. List: bir liste seç
3. Tag: bir tag seç
4. Import başlat
5. **Beklenen:** Tüm eklenen mekanlar "Want to Go" status + seçili liste + seçili tag ile

### T8b.3: Cancel
1. Import başlat, 2-3 batch sonra "Cancel" tıkla
2. **Beklenen:** "Cancelling after current batch..." → mevcut batch bittikten sonra durur
3. Kısmi import sonucu gösterilir

### T8b.4: State persistence
1. Import başlat, %50'de başka sayfaya git
2. Import sayfasına geri dön
3. **Beklenen:** Import devam ediyor (Zustand store)
4. Tamamlanınca result korunuyor

### T8b.5: Duplicate detection
1. Aynı CSV'yi 2 kez import et
2. **Beklenen:** 2. import'ta "Already exists" skip

### T8b.6: 300s timeout yok
1. 50+ mekanlı CSV import et
2. **Beklenen:** Her batch ~15-20sn, toplam süre timeout'a takılmaz

---

## T10b: Sort Tests

### T10b.1: Sort seçenekleri
1. Places sayfasında sort dropdown'ı aç
2. Her seçeneği test et: Newest, Oldest, Name A→Z, Name Z→A, Highest rated, Google rating
3. **Beklenen:** Mekanlar doğru sırada, URL'de `?sort=name_asc`

### T10b.2: Sort + filter kombinasyonu
1. Kategori filtresi + Name A→Z sort
2. **Beklenen:** Filtrelenmiş + sıralanmış sonuçlar

### T10b.3: Sort persistence
1. Sort seç, sayfa yenile
2. **Beklenen:** URL param'dan sort korunur

---

## T11: Trip Planner Tests

### T11.1: Trip oluşturma
1. Lists > My Trips > "Plan Trip"
2. İsim + tarih + listeden mekan seç
3. **Beklenen:** Trip oluşturulur, mekanlar Day 1'de

### T11.2: Auto Plan
1. Trip detayda "Auto Plan" tıkla
2. **Beklenen:** Mekanlar coğrafi olarak günlere dağılır, cafe sabah → restoran akşam

### T11.3: Gün içi drag & drop
1. Mekanları sürükle-bırak ile sırala
2. **Beklenen:** Sıralama değişir, rota (mesafe/süre) güncellenir

### T11.4: Mekan silme
1. Mekan satırında X tıkla → "Remove from trip?" confirm
2. **Beklenen:** Mekan günden çıkar, rota güncellenir

### T11.5: Mekan ekleme
1. "+ Add place" → mekan ara → seç
2. **Beklenen:** Mekan günün sonuna eklenir

### T11.6: Günler arası taşıma
1. ↔ butonuna tıkla → "Day 2" seç
2. **Beklenen:** Mekan Day 1'den Day 2'ye taşınır

### T11.7: Gün sırası değiştirme
1. Day 2'nin ↑ okuna tıkla
2. **Beklenen:** Day 2 ve Day 1 yer değiştirir (day_number + date swap)

### T11.8: Harita görünümü
1. Map toggle'a geç
2. **Beklenen:** Günlük polyline'lar (farklı renkler), day selector pills
3. Tek gün seç → sadece o günün rotası + mekanları

### T11.9: Boş trip
1. Empty trip oluştur (listesiz)
2. **Beklenen:** "No places" mesajı + "+ Add place" her günde

---

## T12: Public Sharing Tests

### T12.1: Liste paylaşma
1. Liste detayda Share butonu tıkla
2. **Beklenen:** "Link copied to clipboard!" toast
3. Linki incognito'da aç
4. **Beklenen:** Auth gerektirmez, liste + harita görünür

### T12.2: Trip paylaşma
1. Trip detayda Share butonu tıkla → link kopyala
2. Incognito'da aç
3. **Beklenen:** Timeline + route polylines görünür

### T12.3: Save to account
1. Shared linki login'li olarak aç
2. "Save to my lists" tıkla
3. **Beklenen:** Yeni liste + mekanlar kopyalanır, `/lists/{new-id}`'e yönlendirilir

### T12.4: Logout UX
1. Shared linki logout'ta aç
2. **Beklenen:** Save butonu yok, altta "Create your free account" CTA

### T12.5: Link devre dışı bırakma
1. Share butonu → link oluştur
2. PATCH /api/shared ile `is_active: false`
3. Linki tekrar aç
4. **Beklenen:** "This link is no longer available." mesajı

---

## T13: Statistics Dashboard Tests

### T13.1: Dashboard yükleme
1. /stats sayfasına git
2. **Beklenen:** Hero stats (4 kart) + visit progress + 4 chart

### T13.2: Hero stats doğruluğu
1. Toplam mekan sayısını places sayfasıyla karşılaştır
2. **Beklenen:** Aynı sayı

### T13.3: Kategori pie chart
1. Kategori dağılımını kontrol et
2. **Beklenen:** Doğru renkler, doğru count'lar

### T13.4: Dark mode charts
1. Dark mode'a geç
2. **Beklenen:** Chart'lar okunabilir, tooltip'ler dark arka planlı

---

## T14: Theme & Appearance Tests

### T14.1: Theme toggle
1. Header'da Sun/Moon/Monitor toggle
2. **Beklenen:** Light → Dark → System cycle, anında uygulanır

### T14.2: Settings > Appearance
1. Settings > Appearance tab
2. Theme kartlarını test et (Light/Dark/System)
3. **Beklenen:** Seçim localStorage'a kaydedilir

### T14.3: Map style
1. Auto, Streets, Satellite, Outdoors, Light, Dark seçeneklerini dene
2. **Beklenen:** Harita stili değişir, marker'lar korunur

### T14.4: System preference
1. OS dark mode'u aç/kapat
2. Theme = System iken
3. **Beklenen:** Uygulama OS'u takip eder

### T14.5: Persistence
1. Dark mode seç, sayfa yenile
2. **Beklenen:** Dark mode korunur (localStorage)

---

## T15: Place Delete Safety Tests

### T15.1: Tekli silme — trip referanslı
1. Trip'te olan bir mekanın detay sayfasına git → Delete
2. **Beklenen:** "This place is part of 1 trip: London Trip. It will be removed from those trips too."

### T15.2: Bulk silme — trip referanslı
1. Places'ta trip'teki mekanları seç → Delete
2. **Beklenen:** "2 of these places are in trips: London Trip..."

### T15.3: Cascade delete doğrulama
1. Trip'teki mekanı sil → trip detaya git
2. **Beklenen:** Mekan trip'ten kaybolmuş, rota güncellenmiş

### T15.4: Cache invalidation
1. Mekanı sil → hemen trip detaya git (sayfa yenilemeden)
2. **Beklenen:** Mekan trip'te görünmüyor (cache invalidated)

---

## v2 Known Limitations

- DataForSEO reviews async polling: 5-60sn bekleme, background'da
- Batch import: her 3 mekan ~15-20sn (DataForSEO API latency)
- Directions API: sadece walking profile (driving opsiyonel)
- Auto-plan: k-means küçük veri setlerinde (<5 mekan) optimal olmayabilir
- Public sharing: read-only, collaborative edit yok (F-11b backlog'da)
- Zustand import store: hard page refresh'te kaybolur (SPA navigation'da korunur)
