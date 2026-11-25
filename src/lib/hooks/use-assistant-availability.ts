"use client";

import { useQuery } from "@tanstack/react-query";

/** GET /api/user/ai-settings — the parts the assistant's entries read. */
interface AiSettingsAnswer {
  enabled?: boolean;
  assistantAvailable?: boolean;
}

export const AI_SETTINGS_KEY = ["ai-settings"] as const;

/**
 * Whether the assistant can be used here: the user has AI features on and
 * the server has its Claude key. One answer for the header button and every
 * screen that opens the assistant with a request (decision 6.1); Settings
 * refreshes it when the switch changes. While it loads, or if it can't be
 * read, the entries stay hidden.
 */
export function useAssistantAvailability(): boolean {
  const { data } = useQuery({
    queryKey: AI_SETTINGS_KEY,
    queryFn: async (): Promise<AiSettingsAnswer> => {
      const res = await fetch("/api/user/ai-settings");
      if (!res.ok) throw new Error("Couldn't read the AI settings");
      return (await res.json()) as AiSettingsAnswer;
    },
    staleTime: 5 * 60 * 1000,
  });
  return Boolean(data?.enabled && data?.assistantAvailable);
}
