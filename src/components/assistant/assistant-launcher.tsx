"use client";

import { Sparkles } from "lucide-react";
import { useAssistantAvailability } from "@/lib/hooks/use-assistant-availability";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { AssistantPanel } from "./assistant-panel";

/**
 * The header's entry to the assistant, and the panel every screen opens.
 * Shown when the user has AI features on and the server can run the
 * assistant (useAssistantAvailability).
 */
export function AssistantLauncher() {
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  const available = useAssistantAvailability();

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
