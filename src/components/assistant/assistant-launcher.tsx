"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AssistantPanel } from "./assistant-panel";

/**
 * v1.21.0 (S3 AI-02): header entry point for the assistant. Gated the
 * same way AiSearchInput is — hidden until GET /api/user/ai-settings
 * confirms the user has AI enabled AND the server has a key (no
 * subscribe-to-changes; refresh after toggling, matching ai-settings.tsx).
 * Also resolves the auth user id so the panel can bind the module-scope
 * conversation to its owner (shared-device account switches).
 */
export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<{
    enabled: boolean;
    available: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [res, { data }] = await Promise.all([
          fetch("/api/user/ai-settings"),
          createClient().auth.getUser(),
        ]);
        if (cancelled) return;
        setUserId(data.user?.id ?? null);
        if (res.ok) setAiSettings(await res.json());
      } catch {
        // Silent fail — the button just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!aiSettings?.enabled || !aiSettings.available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 w-9 flex items-center justify-center rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-accent cursor-pointer transition-colors duration-200"
        aria-label="Open assistant"
        title="Assistant"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <AssistantPanel open={open} onOpenChange={setOpen} userId={userId} />
    </>
  );
}
