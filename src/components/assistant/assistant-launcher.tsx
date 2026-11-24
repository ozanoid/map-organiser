"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { AssistantPanel } from "./assistant-panel";

/**
 * The header's entry to the assistant. Shown when the user has AI features
 * on and the server can run the assistant (its Claude API key is set) —
 * GET /api/user/ai-settings; refresh after changing the setting.
 */
export function AssistantLauncher() {
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/ai-settings");
        if (!res.ok || cancelled) return;
        const settings = (await res.json()) as { enabled?: boolean; assistantAvailable?: boolean };
        if (!cancelled) setAvailable(Boolean(settings.enabled && settings.assistantAvailable));
      } catch {
        // The button just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => openAssistant()}
        className="h-9 w-9 flex items-center justify-center rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-accent cursor-pointer transition-colors duration-200"
        aria-label="Open assistant"
        title="Assistant"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <AssistantPanel />
    </>
  );
}
