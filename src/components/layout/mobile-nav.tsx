"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, MapPin, List, MoreHorizontal, Upload, Settings, X, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/lists", label: "Lists", icon: List },
];

const moreItems = [
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive =
    pathname.startsWith("/import") || pathname.startsWith("/settings");

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute bottom-14 right-4 bg-white dark:bg-gray-900 rounded-xl shadow-xl border p-1.5 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
            {moreItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors",
                    isActive
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm safe-area-pb">
        <div className="flex items-center justify-around h-14">
          {tabs.map((tab) => {
            const isActive =
              pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={false}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-4 py-1.5 cursor-pointer transition-colors",
                  isActive ? "text-emerald-600" : "text-gray-400 dark:text-gray-500"
                )}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More tab */}
          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-4 py-1.5 cursor-pointer transition-colors",
              moreOpen || isMoreActive ? "text-emerald-600" : "text-gray-400 dark:text-gray-500"
            )}
          >
            {moreOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <MoreHorizontal className="h-5 w-5" />
            )}
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
