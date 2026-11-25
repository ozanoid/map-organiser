"use client";

import { AskAssistantButton } from "@/components/assistant/ask-assistant";
import { subjectLabel } from "@/lib/agent/ui-types";
import type { AssistantRequest } from "@/lib/stores/assistant-store";
import type { Plan } from "@/lib/types";

/**
 * The plan page's question for the assistant (Phase 2, decision 6.1; AI
 * Plan, a Gemini dialog, until v1.53.0): spread the plan over its days, or —
 * a plan with fewer than two places — fill it from the want-to-go places.
 * The panel opens with the request written and the plan attached; the user
 * can add to it ("two days, a slow pace") before sending. The change comes
 * back as a card showing the plan as it will be, saved on the user's yes.
 */
export function PlanWithAssistant({ plan }: { plan: Plan }) {
  const request = (): AssistantRequest => {
    const placed = (plan.days ?? []).flatMap((d) => (d.stops ?? []).filter((s) => s.place && s.status === "planned"));
    const text =
      placed.length >= 2
        ? "Bu planı günlere dağıt: yakın yerleri aynı güne koy, kapalı oldukları günlere koyma."
        : `Bu planı${cityOf(placed) ? ` ${cityOf(placed)} için` : ""} istek listemdeki yerlerle doldur.`;
    return {
      text,
      subject: {
        kind: "plan",
        label: subjectLabel({ kind: "plan", plan: { id: plan.id, name: plan.name } }),
        subject: { kind: "plan", planId: plan.id },
      },
    };
  };
  return (
    <AskAssistantButton request={request} className="text-xs">
      Plan with assistant
    </AskAssistantButton>
  );
}

/** The city most of the plan's places are in, if any. */
function cityOf(stops: { place?: { city: string | null } | null }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of stops) if (s.place?.city) counts.set(s.place.city, (counts.get(s.place.city) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
