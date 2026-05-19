"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Map,
  MapPin,
  List,
  BarChart3,
  Upload,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useFilterPersistStore } from "@/lib/stores/filter-persist-store";

/**
 * Sidebar nav items.
 *
 * `preserveSearch=true` carries the current URL's query string when
 * navigating between these routes. Used for /map ↔ /places because they
 * are two views of the SAME filtered dataset — filters and AI search
 * should follow the user across the views.
 *
 * Lists / Stats / Import / Settings don't read the filter context so
 * they're left alone — clicking them gives a clean URL.
 */
const navItems = [
  { href: "/map", label: "Map", icon: Map, preserveSearch: true },
  { href: "/places", label: "Places", icon: MapPin, preserveSearch: true },
  { href: "/lists", label: "Lists", icon: List, preserveSearch: false },
  { href: "/stats", label: "Stats", icon: BarChart3, preserveSearch: false },
  { href: "/import", label: "Import", icon: Upload, preserveSearch: false },
  { href: "/settings", label: "Settings", icon: Settings, preserveSearch: false },
];

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const currentQs = searchParams.toString();
  const lastMapPlacesQuery = useFilterPersistStore(
    (s) => s.lastMapPlacesQuery
  );

  // When the user is currently on /map or /places, the URL's query string
  // IS the filter state — use it directly. Otherwise (they're on /lists,
  // /stats, /settings, /places/[id], etc.) the URL has no filter context,
  // so restore from the persist store. This keeps the round-trip
  // /map → /lists → /map round-trip clean: filters survive even though
  // the intermediate page wiped them from the URL.
  const onFilterContextPage = pathname === "/map" || pathname === "/places";
  const qsForMapPlaces = onFilterContextPage ? currentQs : lastMapPlacesQuery;

  // Top-of-sidebar logo also goes to /map; same logic as the Map nav item.
  const logoHref = qsForMapPlaces ? `/map?${qsForMapPlaces}` : "/map";

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r bg-white dark:bg-gray-950 transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b">
        {!collapsed && (
          <Link href={logoHref} className="flex items-center gap-2">
            <MapPin className="h-6 w-6 text-emerald-600 shrink-0" />
            <span className="font-semibold text-sm">Map Organiser</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 cursor-pointer shrink-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const href =
            item.preserveSearch && qsForMapPlaces
              ? `${item.href}?${qsForMapPlaces}`
              : item.href;
          return (
            <Link
              key={item.href}
              href={href}
              prefetch={false}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
