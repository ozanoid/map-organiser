"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Save, Shield, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ApiKeyData {
  isAdmin: boolean;
  mapboxToken: string;
  hasMapboxToken: boolean;
}

/** The user's own Mapbox token. Places are looked up through the server's
 *  DataForSEO account — there is no Google key to enter (v1.42.0). */

export function ApiKeysManager() {
  const [data, setData] = useState<ApiKeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapboxKey, setMapboxKey] = useState("");
  const [showMapbox, setShowMapbox] = useState(false);
  const [savingMapbox, setSavingMapbox] = useState(false);

  useEffect(() => {
    fetch("/api/user/api-keys")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function saveMapboxKey() {
    setSavingMapbox(true);
    try {
      const res = await fetch("/api/user/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapboxToken: mapboxKey }),
      });
      if (res.ok) {
        toast.success("Mapbox token saved");
        setMapboxKey("");
        const updated = await fetch("/api/user/api-keys").then((r) => r.json());
        setData(updated);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    }
    setSavingMapbox(false);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">API Keys</h3>
        <p className="text-xs text-muted-foreground">
          Enter your own API keys to use the app
        </p>
      </div>

      {data?.isAdmin && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg">
          <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            Admin account — using system API keys
          </span>
        </div>
      )}

      {/* Mapbox Token */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground block">
          Mapbox Token
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showMapbox ? "text" : "password"}
              value={mapboxKey}
              onChange={(e) => setMapboxKey(e.target.value)}
              placeholder={data?.hasMapboxToken ? data.mapboxToken : "Enter your token..."}
              className="h-9 pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowMapbox(!showMapbox)}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              {showMapbox ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <Button
            size="sm"
            className="h-9 cursor-pointer"
            onClick={saveMapboxKey}
            disabled={!mapboxKey.trim() || savingMapbox}
          >
            {savingMapbox ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
        </div>
        <a
          href="https://account.mapbox.com/access-tokens/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-emerald-600 hover:underline"
        >
          Get your token from Mapbox Account
        </a>
      </div>

      {/* Encryption info */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-2">
        <Lock className="h-3 w-3" />
        Keys are encrypted at rest with AES-256-GCM
      </div>
    </div>
  );
}
