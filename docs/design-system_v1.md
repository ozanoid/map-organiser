# Map Organiser - Design System v1

## Tasarim Felsefesi

**Stil:** Minimal, temiz, UX-oncelikli (Zero Interface)
**Mood:** Swiss, functional, neutral, professional
**Prensip:** Kullanici arayuzu mumkun oldugunca gorulmez olmali. Icerik ve veri on planda, dekorasyon arka planda.

---

## 1. Renkler

### Marka Renkleri

| Rol | Hex | Tailwind | Kullanim |
|-----|-----|----------|----------|
| **Primary** | `#059669` | `emerald-600` | Logo, aktif sidebar, CTA |
| **Secondary** | `#10B981` | `emerald-500` | Hover, rating yildiz (user) |
| **CTA / Accent** | `#F97316` | `orange-500` | Google rating yildiz, vurgu |
| **Background** | `#FAFAFA` | `gray-50` | Sayfa arka plani |
| **Text Primary** | `#0F172A` | `slate-900` | Ana metin |
| **Text Muted** | `#64748B` | `slate-500` / `muted-foreground` | Ikincil metin, etiketler |
| **Border** | `#E2E8F0` | `border` / `input` | Input, card, separator |
| **Destructive** | `#EF4444` | `red-500` | Silme, hata |

### Kategori Renkleri (12 Default)

| Kategori | Hex | Tailwind Yakin |
|----------|-----|----------------|
| Restaurant | `#EF4444` | red-500 |
| Cafe | `#F97316` | orange-500 |
| Bar & Nightlife | `#8B5CF6` | violet-500 |
| Hotel & Accommodation | `#3B82F6` | blue-500 |
| Shopping | `#EC4899` | pink-500 |
| Museum & Culture | `#6366F1` | indigo-500 |
| Park & Nature | `#22C55E` | green-500 |
| Beach | `#06B6D4` | cyan-500 |
| Gym & Sports | `#F59E0B` | amber-500 |
| Health & Medical | `#14B8A6` | teal-500 |
| Entertainment | `#A855F7` | purple-500 |
| Other | `#6B7280` | gray-500 |

### Visit Status Renkleri

| Status | Hex | Tailwind | Icon | Badge BG | Badge Border |
|--------|-----|----------|------|----------|-------------- |
| Want to Go | `#F59E0B` | amber-600 | Bookmark | amber-50 | amber-200 |
| Booked | `#3B82F6` | blue-600 | CalendarCheck | blue-50 | blue-200 |
| Visited | `#22C55E` | emerald-600 | CheckCircle2 | emerald-50 | emerald-200 |
| Favorite | `#EF4444` | red-500 | Heart (filled) | red-50 | red-200 |

### Harita Marker Renkleri

| Ogeler | Deger |
|--------|-------|
| Marker dolgu | Kategori rengi (`categoryColor`) |
| Marker stroke (default) | `#FFFFFF` (2px) |
| Marker stroke (visited) | `#22C55E` (3px) |
| Marker stroke (favorite) | `#EF4444` (3px) |
| Marker stroke (booked) | `#3B82F6` (3px) |
| Marker stroke (want_to_go) | `#F59E0B` (2.5px) |
| Cluster dolgu | `#059669` (opacity 0.85) |
| Cluster yazi | `#FFFFFF` |

---

## 2. Tipografi

### Font

| Ozellik | Deger |
|---------|-------|
| **Font ailesi** | Inter |
| **Fallback** | system-ui, -apple-system, sans-serif |
| **Agirliklar** | 300 (light), 400 (regular), 500 (medium), 600 (semibold), 700 (bold) |
| **Google Fonts** | `Inter:wght@300;400;500;600;700` |

### Font Olculeri

| Kullanim | Sinif | Boyut | Agirlik |
|----------|-------|-------|---------|
| Sayfa basligi | `text-xl font-semibold` | 20px | 600 |
| Bolum basligi | `text-sm font-semibold` | 14px | 600 |
| Card basligi | `text-sm font-medium` | 14px | 500 |
| Body metin | `text-sm` | 14px | 400 |
| Kucuk metin | `text-xs` | 12px | 400 |
| Etiket (label) | `text-xs font-medium text-muted-foreground` | 12px | 500 |
| Badge metni | `text-xs font-medium` | 12px | 500 |
| Cok kucuk (VisitStatusBadge) | `text-[10px] font-medium` | 10px | 500 |

### Satir Yuksekligi
- Body: `leading-normal` (1.5)
- Basliklar: `tracking-tight` (letter-spacing: -0.025em)

---

## 3. Aralama (Spacing)

### Genel Aralama Sistemi

| Token | Deger | Tailwind | Kullanim |
|-------|-------|----------|----------|
| 2xs | 2px | `gap-0.5` | Icon-text arasi |
| xs | 4px | `gap-1` | Inline elemanlar |
| sm | 8px | `gap-2`, `p-2` | Icon gaps, tag pill arasi |
| md | 16px | `gap-4`, `p-4` | Standard padding, card icerigi |
| lg | 24px | `gap-6`, `p-6` | Section arasi, sayfa padding |
| xl | 32px | `gap-8` | Buyuk bolumlerdeki bosluklar |

### Sayfa Padding

| Cihaz | Deger |
|-------|-------|
| Mobil | `p-4` (16px) |
| Desktop | `p-6` veya `lg:p-6` (24px) |
| Max width (form/detail) | `max-w-2xl mx-auto` |

### Sidebar

| Ozellik | Deger |
|---------|-------|
| Desktop genislik | `w-56` (224px) - collapsed: `w-16` (64px) |
| Filter sidebar | `w-64` (256px) |
| Padding | `p-4` |
| Item gap | `space-y-1` |

---

## 4. Koseler ve Golge (Radius & Shadow)

### Kose Yuvarlakligi

| Eleman | Sinif | Deger |
|--------|-------|-------|
| Button | `rounded-md` | 6px |
| Input | `rounded-md` | 6px |
| Card | `rounded-lg` | 8px |
| Badge | `rounded-full` | 9999px |
| Photo | `rounded-lg` veya `rounded-xl` | 8-12px |
| Modal | `rounded-2xl` (mobile sheet ust) | 16px |
| Avatar | `rounded-full` | 9999px |
| Filter pill | `rounded-full` | 9999px |
| Popup (map) | `rounded-lg` | 8px |
| FAB | `rounded-full` | 9999px |

### Golge

| Eleman | Sinif |
|--------|-------|
| Card (default) | `shadow-sm` veya `shadow-none` |
| Card (hover) | `shadow-md` |
| Dropdown / Popover | `shadow-lg` |
| Modal / Sheet | `shadow-xl` |
| FAB button | `shadow-lg` |
| Slide-in panel | `shadow-xl` |
| Place count badge (map) | `shadow-md` |

---

## 5. Ikonlar

### Icon Sistemi
- **Kutuphane:** Lucide React
- **Default boyut:** `h-4 w-4` (16px) veya `h-5 w-5` (20px)
- **Kucuk icon:** `h-3 w-3` veya `h-3.5 w-3.5`
- **Buyuk icon (bos durum):** `h-12 w-12`

### Kullanilan Ikonlar

| Icon | Lucide Adi | Kullanim |
|------|-----------|----------|
| Konum pini | `MapPin` | Logo, mekan, konum badge |
| Harita | `Map` | Sidebar nav |
| Liste | `List` | Sidebar nav, liste card |
| Yukle | `Upload` | Import |
| Ayarlar | `Settings` | Sidebar nav |
| Arti | `Plus` | Ekleme butonlari, FAB |
| Arama | `Search` | Arama input |
| Yildiz | `Star` | Rating (dolgu fill ile) |
| Saat | `Clock` | Calisma saatleri |
| Web | `Globe` | Website linki |
| Telefon | `Phone` | Telefon linki |
| Dis link | `ExternalLink` | Google Maps linki |
| Cop | `Trash2` | Silme |
| Geri | `ArrowLeft` | Geri navigasyon |
| Kapat | `X` | Dialog/panel kapatma |
| Link | `Link2` | Parse link butonu |
| Loading | `Loader2` | Spinner (animate-spin) |
| Onay | `Check` | Checkbox, basarili |
| Yer imi | `Bookmark` | Want to Go |
| Takvim | `CalendarCheck` | Booked |
| Onay daire | `CheckCircle2` | Visited |
| Kalp | `Heart` | Favorite (fill ile) |
| Filtre | `SlidersHorizontal` | Filtre butonu (mobil) |
| Chevron | `ChevronLeft`, `ChevronRight` | Sidebar collapse |
| Cikis | `LogOut` | Sign out |
| Klasor | `FolderOpen` | Kategori tab |
| Etiket | `Tag` | Tag tab |
| Kalkan | `Shield` | Admin badge, API & Usage tab |
| Kilit | `Lock` | Encryption bilgisi |
| Goz | `Eye`, `EyeOff` | API key goster/gizle |
| Kaydet | `Save` | API key kaydetme |
| Kare (secim) | `Square`, `CheckSquare` | Bulk select |
| Yenile | `RefreshCw` | Google data refresh |

### Anti-Patterns
- **ASLA emoji kullanma** (🍴 ❌) → Lucide SVG icon kullan
- **ASLA farkli icon kutuphanleri karistirma** → sadece Lucide

---

## 6. Component Spesifikasyonlari

### Button Varyantlari

| Varyant | Siniflar | Kullanim |
|---------|----------|----------|
| Primary (default) | `bg-primary text-primary-foreground` | Ana aksiyonlar (Save, Create) |
| Outline | `border border-input bg-background` | Ikincil aksiyonlar (Cancel, Google Maps) |
| Ghost | `hover:bg-accent` | Ikon butonlari, inline aksiyonlar |
| Destructive | `bg-destructive text-white` veya `text-red-500` | Silme |

**Tum butonlarda:** `cursor-pointer` zorunlu, `transition-colors` veya `transition-all duration-200`

### Input

```
Siniflar: h-9 px-3 text-sm border border-input rounded-md bg-background
Focus: focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
```

### Native Select (Dropdown)

```
Siniflar: w-full h-9 px-3 pr-8 text-sm border border-input rounded-md 
          bg-background cursor-pointer appearance-none
Chevron: Absolute pozisyonlu SVG (right-2.5, pointer-events-none)
```

**Not:** Base UI Select guvenilir calismadigindan tum dropdown'larda native `<select>` kullanilir.

### Card

```
Siniflar: rounded-lg border bg-card p-4
Hover: hover:shadow-md transition-shadow
Secili: ring-2 ring-emerald-500 (bulk select)
```

### Badge

| Varyant | Siniflar | Kullanim |
|---------|----------|----------|
| Default | `bg-primary text-primary-foreground` | Kategori (custom color ile) |
| Secondary | `bg-secondary text-secondary-foreground` | Varsayilan |
| Outline | `border` | Konum badge |
| Visit Status | Custom bg + border + text renkleri | Status badge |

### Filter Pill (Visit Status)

```
Aktif: bg-emerald-50 text-emerald-700 border border-emerald-200
Pasif: bg-gray-100 text-gray-600 hover:bg-gray-200
Boyut: px-2.5 py-1 text-xs font-medium rounded-full
```

### Category Pill (Filter — Multi-Select)

```
Aktif: style={{ backgroundColor: cat.color }} text-white (kategori rengiyle dolar)
Pasif: bg-gray-100 text-gray-600 hover:bg-gray-200
"All" pill: bg-emerald-100 text-emerald-700 (hicbir kategori secili degilken)
Boyut: px-2.5 py-1 text-xs font-medium rounded-full
Coklu secim: birden fazla pill ayni anda aktif olabilir (orn: Restaurant + Bar)
Renk noktasi: her pill'de w-2 h-2 rounded-full shrink-0 (kategori rengi)
```

### Tag Pill (Filter)

```
Aktif (renk varsa): style={{ backgroundColor: tag.color }} text-white
Aktif (renk yoksa): bg-emerald-600 text-white
Pasif: bg-gray-100 text-gray-600 hover:bg-gray-200
```

### Visit Status Toggle

```
Aktif: [status].activeBg + [status].activeColor border rounded-full
Pasif: border-gray-200 text-gray-500 hover:border-gray-300
Size sm: px-2 py-0.5 text-xs
Size md: px-3 py-1 text-sm
```

---

## 7. Layout Sistemi

### Desktop (>=1024px)

```
┌──────────────────────────────────────────────────────────┐
│  Header (h-14, border-b, bg-white)                       │
│  [Logo | _____________spacer____________ | +Add | Avatar]│
├──────┬────────┬──────────────────────────────────────────┤
│ Nav  │ Filter │                                          │
│ Side │ Side   │         Main Content Area                │
│ bar  │ bar    │                                          │
│ w-56 │ w-64   │         (flex-1)                         │
│      │        │                                          │
└──────┴────────┴──────────────────────────────────────────┘
```

- Navigation sidebar: `w-56` (collapsible → `w-16`)
- Filter sidebar: `w-64` (map ve places sayfalarinda)
- Header: `h-14`, fixed top
- Main: `flex-1 overflow-auto`

### Mobil (<768px)

```
┌──────────────────────────┐
│ Header (h-14)            │
│ [Logo | + | Avatar]      │
├──────────────────────────┤
│                          │
│     Main Content         │
│     (full-width)         │
│                          │
│                          │
├──────────────────────────┤
│ Bottom Nav (h-14)        │
│ [Map] [Places] [Lists]  │
└──────────────────────────┘
```

- Bottom tab bar: `fixed bottom-0`, `h-14`, `z-50`
- Main padding bottom: `pb-14` (tab bar yuksekligi)
- Filter: Bottom sheet (`max-h-[65dvh]`)
- FAB: `bottom-20 right-4` (tab bar uzerinde)

### Tablet (768-1023px)

- Navigation sidebar: overlay (toggle ile)
- Filter: Sheet veya inline
- Grid: 2 kolon

### Responsive Grid

| Sayfa | Mobil | Tablet | Desktop |
|-------|-------|--------|---------|
| Places | 1 kolon | 2 kolon | 3-4 kolon |
| Lists | 1 kolon | 2 kolon | 3 kolon |
| Settings | 1 kolon | 1 kolon (max-w-2xl) | 1 kolon (max-w-2xl) |

---

## 8. Animasyon ve Gecisler

### Genel Kurallar
- Tum gecisler `150-300ms` arasinda
- `prefers-reduced-motion` saygili olunmali
- Layout-shifting hover'lar yasak (scale yerine opacity/shadow/color)

### Spesifik Gecisler

| Eleman | Gecis |
|--------|-------|
| Button hover | `transition-colors duration-200` |
| Card hover | `transition-shadow` (shadow-sm → shadow-md) |
| Sidebar collapse | `transition-all duration-200` |
| Loading spinner | `animate-spin` (Loader2 icon) |
| Toast | Sonner default animation |
| Sheet/Dialog | Base UI default (slide/fade) |
| Map popup | Mapbox default |
| Slide-in panel | Implicit (DOM insert → render) |

---

## 9. Eriselebilirlik (Accessibility)

### Zorunlu Kurallar
- Tum interactive elemanlar `cursor-pointer`
- Tum input'lar `label` ile iliskilendirilmis
- Minimum kontrast orani: 4.5:1 (normal metin)
- Focus ring: `outline-ring/50` (global base stilde)
- Touch target: minimum 44x44px (mobil)
- Semantic HTML: `<nav>`, `<main>`, `<header>`, `<aside>`, `<button>`

### Keyboard Navigasyon
- Tab sirasi gorsel sirayi takip eder
- Dialog/Sheet acikken focus trap aktif (Base UI otomatik)
- Escape ile dialog kapatma (Base UI otomatik)

### Renk Bagimsizligi
- Renk tek basina bilgi tasiyici degil (ikon + metin + renk birlikte)
- Visit status: renk + ikon + metin
- Kategori: renk noktasi + metin

---

## 10. Bos Durumlar (Empty States)

Her sayfada veri yokken gosterilen bos durum:

| Sayfa | Icon | Mesaj |
|-------|------|-------|
| Places | `MapPin` (h-12 w-12, gray-300) | "No places yet. Add your first place." |
| Lists | `List` (h-12 w-12, gray-300) | "No lists yet. Create a list." |
| Tags | - | "No tags yet. Create your first tag above." |
| Import | `Upload` (h-10 w-10, gray-300) | "Drag & drop your file here" |
| Categories | - | "No categories yet" |

**Stil:** Center-aligned, `py-20`, muted colors

---

## 11. Toast / Bildirim Sistemi

**Kutuphane:** Sonner

### Kullanim Kaliplari

| Durum | Ornek |
|-------|-------|
| Basarili | `toast.success("Place saved!")` |
| Hata | `toast.error("Failed to parse link")` |
| Bilgi | `toast.info("Coming soon")` |

### Stil
- Position: bottom-right (desktop), bottom-center (mobil)
- Otomatik kapanma: ~4 saniye
- Sonner default theme (shadcn entegrasyonu)

---

## 12. Form Select Karari

### Neden Native `<select>` Kullaniyoruz?

Base UI (shadcn/ui v2) Select componentleri projede su sorunlari cikardi:
1. **UUID gosterme:** SelectValue, children olmadan raw value (UUID) gosteriyor
2. **SelectValue children ekleyince secim bozulur:** Tiklaninca item secilmiyor
3. **"All" secenememe:** Bir deger secildikten sonra bos/default degere donulemiyor
4. **Mobilde sorun:** iOS'ta native picker acilmiyor

**Cozum:** Tum dropdown filtreleri ve form select'leri native `<select>` ile degistirildi.

**Stillendirilmis Native Select:**
```html
<div className="relative">
  <select className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1">
    <option value="">Placeholder...</option>
    ...
  </select>
  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none">
    <path d="m6 9 6 6 6-6" />
  </svg>
</div>
```

**× Temizleme Butonu (Country + List dropdown):**
```html
{value && (
  <Button className="absolute right-7 top-1/2 -translate-y-1/2 h-5 w-5 p-0 cursor-pointer z-10"
    onClick={(e) => { e.stopPropagation(); clearFilter(); }}>
    <X className="h-3 w-3" />
  </Button>
)}
```
- `z-10` ile select'in uzerinde render edilir
- `stopPropagation()` ile select tiklamasindan izole edilir
- Sadece filtre aktifken gorulur (`value &&`)

**Istisna:** shadcn Dialog, Sheet, Popover, Tabs, Badge, Card gibi non-select componentler hala Base UI uzerinden calisir ve sorunsuzdur.

---

## 13. Mapbox Harita Stili

| Ozellik | Deger |
|---------|-------|
| Base stil | `mapbox://styles/mapbox/light-v11` |
| Default center | `[29.0, 41.0]` (Istanbul) |
| Default zoom | `5` |
| Attribution | Gizli |
| Navigation | Compass gizli, zoom butonlari gorunur |
| Geolocate | Aktif (yuksek hassasiyet) |

### Cluster Ayarlari
| Ozellik | Deger |
|---------|-------|
| clusterMaxZoom | 14 |
| clusterRadius | 50 |
| Cluster rengi | `#059669` (emerald) |
| Cluster opacity | 0.85 |
| Cluster boyutu | 18px / 24px / 30px (point count'a gore) |
| Cluster yazi rengi | `#FFFFFF` |
| Cluster yazi boyutu | 13px |

### Marker Ayarlari
| Ozellik | Deger |
|---------|-------|
| circle-radius | 8px |
| circle-color | `categoryColor` (data-driven) |
| circle-stroke-color | visit status'a gore (data-driven) |
| circle-stroke-width | 2-3px (visit status'a gore) |

---

## 14. Pre-Delivery Checklist

Herhangi bir UI kodu teslim etmeden once kontrol et:

### Gorsel Kalite
- [ ] Emoji yerine SVG icon kullanildi (Lucide)
- [ ] Tum ikonlar ayni kutuphane (Lucide React)
- [ ] Hover'lar layout shift yapmadi (scale yerine opacity/shadow)
- [ ] `cursor-pointer` tum tiklanabilir elemanlarda var
- [ ] Gecisler 150-300ms (instant degisim yok)

### Eriselebilirlik
- [ ] Kontrast orani >= 4.5:1
- [ ] Focus ring gorunur
- [ ] Input'lar label ile iliskili
- [ ] Touch target >= 44x44px (mobil)

### Responsive
- [ ] 375px (iPhone SE) test edildi
- [ ] 768px (iPad) test edildi
- [ ] 1024px (laptop) test edildi
- [ ] 1440px (desktop) test edildi
- [ ] Yatay scroll yok (mobil)
- [ ] Fixed navbar arkasinda icerik gizlenmiyor

### Tutarlilik
- [ ] Native `<select>` kullanildi (Base UI Select degil)
- [ ] Renk paleti tutarli (kategori, status, marka renkleri)
- [ ] Spacing tutarli (4/8/16/24 sistemi)
- [ ] Border radius tutarli (md/lg/full)
