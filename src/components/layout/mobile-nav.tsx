"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, MapPin, List } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/lists", label: "Lists", icon: List },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur-sm safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-1.5 cursor-pointer transition-colors",
                isActive ? "text-emerald-600" : "text-gray-400"
              )}
            >
              <tab.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
