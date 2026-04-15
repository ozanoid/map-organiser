"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Save, Shield, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ApiKeyData {
  isAdmin: boolean;
  googleApiKey: string;
  mapboxToken: string;
  hasGoogleKey: boolean;
  hasMapboxToken: boolean;
  googlePlacesEnabled: boolean;
}

export function ApiKeysManager() {
  const [data, setData] = useState<ApiKeyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleKey, setGoogleKey] = useState("");
  const [mapboxKey, setMapboxKey] = useState("");
  const [showGoogle, setShowGoogle] = useState(false);
  const [showMapbox, setShowMapbox] = useState(false);
  const [savingGoogle, setSavingGoogle] = useState(false);
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

  async function saveGoogleKey() {
    setSavingGoogle(true);
    try {
      const res = await fetch("/api/user/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleApiKey: googleKey }),
      });
      if (res.ok) {
        toast.success("Google API key saved");
        setGoogleKey("");
        // Refresh data
        const updated = await fetch("/api/user/api-keys").then((r) => r.json());
        setData(updated);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    }
    setSavingGoogle(false);
  }

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
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
          <Shield className="h-4 w-4 text-emerald-600" />
          <span className="text-xs text-emerald-700 font-medium">
            Admin account — using system API keys
          </span>
        </div>
      )}

      {/* Google Places API Toggle */}
      <div className="flex items-center justify-between py-2 px-3 border rounded-lg">
        <div>
          <p className="text-sm font-medium">Google Places API</p>
          <p className="text-[10px] text-muted-foreground">
            Use Google for fast place lookup when adding links
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data?.googlePlacesEnabled ?? true}
          onClick={async () => {
            const newVal = !(data?.googlePlacesEnabled ?? true);
            setData((prev) => prev ? { ...prev, googlePlacesEnabled: newVal } : prev);
            await fetch("/api/user/api-keys", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ googlePlacesEnabled: newVal }),
            });
            toast.success(newVal ? "Google Places API enabled" : "Google Places API disabled");
          }}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            data?.googlePlacesEnabled ? "bg-emerald-600" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              data?.googlePlacesEnabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Google Places API Key */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground block">
          Google Places API Key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showGoogle ? "text" : "password"}
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder={data?.hasGoogleKey ? data.googleApiKey : "Enter your API key..."}
              className="h-9 pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowGoogle(!showGoogle)}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              {showGoogle ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <Button
            size="sm"
            className="h-9 cursor-pointer"
            onClick={saveGoogleKey}
            disabled={!googleKey.trim() || savingGoogle}
          >
            {savingGoogle ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-emerald-600 hover:underline"
        >
          Get your key from Google Cloud Console
        </a>
      </div>

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
