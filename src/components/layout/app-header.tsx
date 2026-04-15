"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AddPlaceDialog } from "@/components/places/add-place-dialog";
import { Plus, Search, LogOut, Settings, MapPin, Sun, Moon, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import type { User } from "@supabase/supabase-js";

export function AppHeader() {
  const [addOpen, setAddOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, [supabase.auth]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials =
    user?.user_metadata?.full_name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b bg-white dark:bg-gray-950 shrink-0">
      <div className="flex items-center gap-2 lg:hidden">
        <MapPin className="h-6 w-6 text-emerald-600" />
        <span className="font-semibold text-sm">Map Organiser</span>
      </div>

      <div className="hidden lg:block" />

      <div className="flex items-center gap-2">
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}
            className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors duration-200"
            aria-label={`Theme: ${theme}. Click to switch.`}
            title={`Theme: ${theme}`}
          >
            {theme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : theme === "system" ? (
              <Monitor className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 cursor-pointer"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Place</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="h-8 w-8 rounded-full cursor-pointer focus:outline-none">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.user_metadata?.avatar_url} />
              <AvatarFallback className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => router.push("/settings")}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-red-600"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AddPlaceDialog open={addOpen} onOpenChange={setAddOpen} />
    </header>
  );
}
