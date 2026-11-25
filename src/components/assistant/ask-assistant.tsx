"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistantAvailability } from "@/lib/hooks/use-assistant-availability";
import { cn } from "@/lib/utils";
import { useAssistantStore, type AssistantRequest } from "@/lib/stores/assistant-store";

/**
 * A screen's door to the assistant (Phase 2, decision 6.1): opens the panel
 * with the request written and what it is about attached. `request` runs on
 * click, so it reads the screen as it is then. Renders nothing when the
 * assistant can't be used (useAssistantAvailability) — a screen that wraps
 * it in more than a button checks the same hook.
 */
export function AskAssistantButton({
  request,
  children,
  className,
}: {
  request: () => AssistantRequest;
  children: ReactNode;
  className?: string;
}) {
  const available = useAssistantAvailability();
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  if (!available) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => openAssistant(request())}
      className={cn(
        "cursor-pointer gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {children}
    </Button>
  );
}
