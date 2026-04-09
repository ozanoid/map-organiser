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
import { Plus, Search, LogOut, Settings, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export function AppHeader({
  onAddPlace,
}: {
  onAddPlace?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);

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
    <header className="flex items-center justify-between h-14 px-4 border-b bg-white shrink-0">
      <div className="flex items-center gap-2 lg:hidden">
        <MapPin className="h-6 w-6 text-emerald-600" />
        <span className="font-semibold text-sm">Map Organiser</span>
      </div>

      <div className="hidden lg:block" />

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 cursor-pointer"
          onClick={onAddPlace}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Place</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="h-8 w-8 rounded-full cursor-pointer focus:outline-none">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.user_metadata?.avatar_url} />
              <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs">
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
    </header>
  );
}
