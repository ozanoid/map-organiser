"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface AiSettingsState {
  enabled: boolean;
  available: boolean;
}

/**
 * Settings → AI tab.
 *
 * Phase 1: Master toggle only. Future phases will add a "Pending Suggestions"
 * section (Phase 5) under this same component.
 */
export function AiSettings() {
  const [state, setState] = useState<AiSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    try {
      const res = await fetch("/api/user/ai-settings");
      if (!res.ok) throw new Error("Failed to load AI settings");
      const data = (await res.json()) as AiSettingsState;
      setState(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(next: boolean) {
    if (!state) return;
    setSaving(true);
    // Optimistic update
    setState({ ...state, enabled: next });
    try {
      const res = await fetch("/api/user/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to update AI settings");
      }
      toast.success(next ? "AI features enabled" : "AI features disabled");
    } catch (e) {
      // Rollback
      setState({ ...state, enabled: !next });
      toast.error(e instanceof Error ? e.message : "Failed to update AI settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!state) return null;

  const disabled = !state.available || saving;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold">AI Features</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            When enabled: smart categorization, tag &amp; list suggestions,
            place profiles, and AI search.
          </p>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label="Enable AI features"
          disabled={disabled}
          onClick={() => handleToggle(!state.enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
            state.enabled ? "bg-emerald-600" : "bg-gray-200 dark:bg-gray-700"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
              state.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {!state.available && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            AI features are not configured on this deployment. The
            <code className="font-mono mx-1 text-[10px] bg-amber-100 dark:bg-amber-900/60 px-1 rounded">
              GOOGLE_GENERATIVE_AI_API_KEY
            </code>
            environment variable is missing.
          </div>
        </div>
      )}

      {/* Phase 5 placeholder: Pending Suggestions section will live here. */}
    </div>
  );
}
