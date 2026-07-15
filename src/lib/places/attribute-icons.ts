import {
  Accessibility,
  Armchair,
  Baby,
  Beer,
  Calendar,
  Coffee,
  CreditCard,
  Dog,
  Info,
  Martini,
  ParkingCircle,
  Salad,
  Sparkles,
  UtensilsCrossed,
  Wifi,
  Wine,
  type LucideIcon,
} from "lucide-react";

/**
 * NF-04 (v1.18.0) — DataForSEO attribute key → display group + icon.
 *
 * DataForSEO flattens its attribute groups away before storage (see
 * transform.ts), and the raw group names are inconsistent anyway — so
 * grouping is reconstructed here from stable key-prefix conventions.
 * Icons: a small curated map for high-signal attributes; everything else
 * falls back to its group icon.
 */

export interface AttributeGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Match order matters — first hit wins. */
  match: (attr: string) => boolean;
  /** Strip group prefixes for display ("feels_romantic" → "Romantic"). */
  clean: (attr: string) => string;
}

const strip = (attr: string, ...prefixes: string[]) => {
  for (const p of prefixes) {
    if (attr.startsWith(p)) return attr.slice(p.length);
  }
  return attr;
};

export const ATTRIBUTE_GROUPS: AttributeGroup[] = [
  {
    key: "accessibility",
    label: "Accessibility",
    icon: Accessibility,
    match: (a) => a.includes("wheelchair") || a.startsWith("accessib"),
    clean: (a) => strip(a, "has_wheelchair_accessible_", "has_", "is_"),
  },
  {
    key: "food-drink",
    label: "Food & Drink",
    icon: UtensilsCrossed,
    match: (a) => a.startsWith("serves_"),
    clean: (a) => strip(a, "serves_"),
  },
  {
    key: "payments",
    label: "Payments",
    icon: CreditCard,
    match: (a) => a.startsWith("pay_") || a.startsWith("accepts_pay"),
    clean: (a) => strip(a, "pay_"),
  },
  {
    key: "atmosphere",
    label: "Atmosphere",
    icon: Sparkles,
    match: (a) => a.startsWith("feels_"),
    clean: (a) => strip(a, "feels_"),
  },
  {
    key: "planning",
    label: "Planning",
    icon: Calendar,
    match: (a) =>
      a.includes("reservation") || a.startsWith("requires_") || a.includes("appointment"),
    clean: (a) => strip(a, "accepts_", "recommends_", "requires_"),
  },
  {
    key: "crowd",
    label: "Good to know",
    icon: Info,
    match: (a) =>
      a.startsWith("welcomes_") ||
      a.startsWith("allows_") ||
      a.startsWith("suitable_") ||
      a.startsWith("is_"),
    clean: (a) => strip(a, "welcomes_", "allows_", "suitable_for_", "is_"),
  },
  {
    key: "facilities",
    label: "Facilities",
    icon: Armchair,
    match: (a) => a.startsWith("has_"),
    clean: (a) => strip(a, "has_"),
  },
  {
    key: "other",
    label: "Other",
    icon: Info,
    match: () => true,
    clean: (a) => a,
  },
];

/** High-signal per-attribute icons (fallback: the group icon). */
const ATTRIBUTE_ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  has_wifi: Wifi,
  free_wifi: Wifi,
  allows_dogs_inside: Dog,
  allows_dogs: Dog,
  serves_coffee: Coffee,
  serves_coffee_notable: Coffee,
  serves_beer: Beer,
  serves_wine: Wine,
  serves_wine_notable: Wine,
  serves_cocktails: Martini,
  serves_liquor: Martini,
  serves_vegetarian: Salad,
  serves_vegetarian_food: Salad,
  welcomes_children: Baby,
  has_parking_street_paid: ParkingCircle,
  has_parking: ParkingCircle,
};

export function groupForAttribute(attr: string): AttributeGroup {
  return ATTRIBUTE_GROUPS.find((g) => g.match(attr)) ?? ATTRIBUTE_GROUPS[ATTRIBUTE_GROUPS.length - 1];
}

export function iconForAttribute(attr: string): LucideIcon {
  return ATTRIBUTE_ICONS[attr] ?? groupForAttribute(attr).icon;
}

/** Tokens that naive title-casing mangles ("Lgbtq", "Nfc"…). */
const ACRONYMS: Record<string, string> = {
  Lgbtq: "LGBTQ+",
  Nfc: "NFC",
  Tv: "TV",
  Atm: "ATM",
  Byob: "BYOB",
  Wifi: "Wi-Fi",
};

/** "serves_wine_notable" → "Wine Notable" (group prefix stripped, title case). */
export function labelForAttribute(attr: string): string {
  return groupForAttribute(attr)
    .clean(attr)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Lgbtq|Nfc|Tv|Atm|Byob|Wifi)\b/g, (t) => ACRONYMS[t] ?? t);
}
