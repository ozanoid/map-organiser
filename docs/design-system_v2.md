# Map Organiser - Design System v2

> **v2 Güncelleme:** 2026-04-16
> **Önceki:** design-system_v1.md (2026-04-11)
> **Yeni:** Dark mode, custom markers, trip UI, stats charts, import progress, share page

---

v1 design system'ı (`design-system_v1.md`) hâlâ geçerlidir. Bu doküman sadece v2'de eklenen/değişen bileşenleri kapsar.

---

## 1. Dark Mode & Tema

### CSS Variables
- `:root` (light) + `.dark` (dark) → `globals.css` oklch renk sistemi
- Tüm semantic renkler: background, foreground, card, primary, muted, accent, border, ring
- Sidebar, chart, input renkleri dahil

### Tailwind Dark Variants
14+ component'a `dark:` prefix eklendi:

| Component | Light | Dark |
|-----------|-------|------|
| `bg-white` | Beyaz arka plan | `dark:bg-gray-950` |
| `bg-gray-100` | Açık gri | `dark:bg-gray-800` |
| `text-gray-600` | Muted text | `dark:text-gray-400` |
| `bg-emerald-50` | Aktif pill bg | `dark:bg-emerald-900/50` |
| `text-emerald-700` | Aktif pill text | `dark:text-emerald-300` |
| `hover:bg-gray-100` | Hover | `dark:hover:bg-gray-800` |
| `border-gray-100` | Border | `dark:border-gray-800` |

### Theme Toggle
- Header'da ghost button: Sun → Moon → Monitor (3-state cycle)
- `h-9 w-9`, `useTheme()` from next-themes
- Mounted kontrolü (hydration flash önlemi)

### Mapbox Popup Dark
```css
.dark .mapboxgl-popup-content { background: #1a1a2e; color: #e2e8f0; }
.dark .mapboxgl-popup-tip { border-top-color: #1a1a2e; }
```

---

## 2. Custom Map Markers

### İki Marker Stili

**Dots (basit):**
- Mevcut circle layer
- `circle-color`: kategori rengi
- `circle-radius`: 8px
- `circle-stroke`: visit status rengi (2-3px)

**Icons (kategori ikonlu):**
- Canvas hybrid: Lucide SVG → 80x80 canvas → `map.addImage()`
- Dolu daire (kategori rengi) + beyaz stroke + beyaz ikon ortada
- Symbol layer: `icon-image: ["concat", "cat-", ["get", "categoryIcon"]]`

### 12 Kategori İkonu
| Kategori | Lucide İkon |
|----------|-------------|
| Restaurant | utensils |
| Cafe | coffee |
| Bar & Nightlife | wine |
| Hotel | bed |
| Shopping | shopping-bag |
| Museum & Culture | landmark |
| Park & Nature | trees |
| Beach | waves |
| Gym & Sports | dumbbell |
| Health & Medical | heart-pulse |
| Entertainment | ticket |
| Other | map-pin |

### Settings'te İkon Seçici
- Kategori oluşturma/düzenlemede 12 ikon grid
- Kategori listesinde ikon+renk dairesi gösterimi

---

## 3. Trip Planner UI

### Timeline View
```
📅 Day 1 — Fri 18 Apr          2.5 km · 31 min   ↑↓
  ├─ 1 ⠿ ☕ Dusty Knuckle                        ↔ ✕
  │      ↓ 0.8 km · 10 min
  ├─ 2 ⠿ 🏛 V&A Childhood                       ↔ ✕
  │      ↓ 1.2 km · 15 min
  ├─ 3 ⠿ 🍽 Berber & Q                           ↔ ✕
  └─ + Add place
```

### Bileşenler
| Eleman | Stil |
|--------|------|
| Day header | Renkli daire (day color) + font-semibold + tarih |
| Day arrows | ↑↓ ChevronUp/Down, disabled at edges |
| Place row | GripVertical + numara + renk dairesi + isim + adres |
| Leg info | `text-[9px] text-muted-foreground` — "0.8 km · 10 min" |
| Move dropdown | Floating menu, day colors, rounded-lg shadow-xl |
| Remove button | X icon, hover:text-red-500, group-hover:opacity-100 |
| Add place | `+ Add place` text link, text-muted-foreground |

### Day Colors
```typescript
["#3B82F6", "#F97316", "#8B5CF6", "#22C55E", "#EC4899", "#06B6D4", "#F59E0B"]
```

### Map View
- Day-colored polylines (line layer, width 4, opacity 0.8)
- Day selector pills (alt tarafta, rounded-full)
- "All" pill: emerald-600

---

## 4. Statistics Dashboard

### Chart Konfigürasyonu (Recharts)
| Chart | Tip | Renk |
|-------|-----|------|
| Category | PieChart (donut) | Kategori renkleri |
| Top Cities | BarChart (horizontal) | #059669 (emerald) |
| Monthly Trend | AreaChart | #059669 stroke, 0.15 fill |
| Rating | BarChart | #F97316 (orange) |

### Tooltip Stili
```typescript
contentStyle: {
  borderRadius: "8px",
  fontSize: "12px",
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
}
```

### Hero Card
- `h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950`
- `text-2xl font-bold` sayı + `text-[10px] text-muted-foreground` label

---

## 5. Import Progress UI

### Phases: idle → options → importing → done

**Options Card:**
- Visit status pills (5 seçenek, emerald aktif)
- List pills (multi-select, list renkleriyle)
- Tag pills (multi-select, emerald aktif)

**Progress Card:**
- `Importing... {current} / {total}` + `{pct}%`
- Progress bar: `h-2 bg-emerald-500 rounded-full transition-all duration-500`
- Son 4 mekan: ✓ enriched (emerald), ✓ imported (blue), ✗ skipped (red)
- Cancel: `StopCircle` icon, text-red-500

---

## 6. Public Share Page

### Layout
- Standalone: sidebar yok, nav yok
- Header: MapPin + "Map Organiser" + Save button (login'li ise)
- Harita: `h-64 sm:h-80 rounded-xl border`
- Place list: numaralı, renk dairesi + isim + adres + rating + Maps link
- Footer: "Organize your own saved places" + signup CTA (emerald-600 button)

### Trip Share
- Aynı layout + day timeline + day-colored polylines
- Leg bilgisi mekanlar arası

---

## 7. Viewport Place Count

### Badge
- `bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-full`
- Tıklanabilir: ChevronDown/Up toggle
- Dropdown: `w-64 max-h-[50dvh] overflow-y-auto rounded-xl shadow-xl border`
- Dropdown item: renk dairesi + isim + adres, `hover:bg-gray-50`

---

## 8. Sort Select

### Placement
- Search input satırının sağında (inline)
- ArrowUpDown ikonu sol tarafta

### Stili
- `h-9 pl-8 pr-7 text-sm border-input rounded-md bg-background cursor-pointer appearance-none`
- Native `<select>` (design system kuralı)
- 6 seçenek: Newest, Oldest, Name A→Z, Name Z→A, Highest rated, Google rating

---

## 9. Güncellenen Navigasyon

### Sidebar (Desktop)
```
Map, Places, Lists, Stats, Import, Settings
```

### Mobile (More menüsü)
```
Stats, Import, Settings
```

### Settings Tabs
```
Cats | Tags | API | Theme
```
(Mobilde kısa label'lar: Categories→Cats, API & Usage→API, Appearance→Theme)

---

## 10. v2 Pre-Delivery Checklist Ekleri

### Dark Mode
- [ ] Tüm `bg-white` → `dark:bg-gray-950`
- [ ] Tüm `bg-gray-100` → `dark:bg-gray-800`
- [ ] Tüm `text-gray-600` → `dark:text-gray-400`
- [ ] Chart tooltip'ler CSS var kullanıyor
- [ ] Mapbox popup dark override var
- [ ] Her iki modda kontrast 4.5:1+

### Trip UI
- [ ] Drag handle touch-none
- [ ] Move dropdown z-50 + backdrop
- [ ] Day arrows disabled at edges
- [ ] "+ Add place" tüm günlerde görünür

### Import
- [ ] Progress bar transition-all duration-500
- [ ] Cancel batch arası çalışıyor
- [ ] State sayfa değişiminde korunuyor (Zustand)
