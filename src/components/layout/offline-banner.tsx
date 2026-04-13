"use client";

import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
    }
    function handleOnline() {
      setIsOffline(false);
    }

    // Check initial state
    setIsOffline(!navigator.onLine);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-14 left-0 right-0 z-40 bg-amber-500 text-white text-xs font-medium text-center py-1.5 px-4 flex items-center justify-center gap-1.5">
      <WifiOff className="h-3.5 w-3.5" />
      You&apos;re offline. Some features may not work.
    </div>
  );
}
