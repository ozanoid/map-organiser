"use client";

import { Sparkles } from "lucide-react";
import { AskAssistantButton } from "@/components/assistant/ask-assistant";
import { subjectLabel } from "@/lib/agent/ui-types";
import { useAssistantAvailability } from "@/lib/hooks/use-assistant-availability";
import type { AssistantRequest } from "@/lib/stores/assistant-store";

/**
 * The compare page's question for the assistant (Phase 2, decision 6.1;
 * until v1.52.0 a Gemini card here gave per-theme winners): which of these
 * places when. The request opens the panel with the places attached; the
 * answer comes in the chat, in the user's language, and stays with the
 * conversation. The columns below stay as they are.
 */
export function CompareWithAssistant({ places }: { places: { id: string; name: string }[] }) {
  const available = useAssistantAvailability();
  if (!available || places.length < 2) return null;

  const request = (): AssistantRequest => ({
    text: "Bu yerleri karşılaştır: hangisi ne zaman daha iyi?",
    subject: {
      kind: "places",
      label: subjectLabel({ kind: "places", places: places.map((p) => ({ id: p.id, name: p.name })) }),
      subject: { kind: "places", placeIds: places.map((p) => p.id) },
    },
  });

  return (
    <div className="border rounded-xl p-4 flex items-center justify-between gap-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
      <div className="text-sm min-w-0">
        <p className="font-medium flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden />
          Which one, when?
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          The assistant weighs them from their reviews and your notes, in the chat.
        </p>
      </div>
      <AskAssistantButton request={request} className="shrink-0">
        Ask the assistant
      </AskAssistantButton>
    </div>
  );
}
