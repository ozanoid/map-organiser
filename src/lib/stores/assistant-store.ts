import { create } from "zustand";
import type { SubjectPart } from "@/lib/agent/ui-types";

/**
 * The assistant panel, app-wide: whether it is open, and what its composer
 * holds. The header button opens it; other screens open it with a request
 * already written (Phase 2, decision 6.1): the plan page, the compare page,
 * the search field.
 *
 * The composer lives here, not in the panel, so a request survives "New
 * chat" and closing the panel; a reload drops it (the screen's button is one
 * click away, and a sent message lives on the server).
 */

/** A request from a screen: its text and what it is about. `send`: the text
 *  is the user's own (the search field) — send it as soon as the panel can,
 *  instead of waiting in the composer. */
export type AssistantRequest = { text: string; subject?: SubjectPart | null; send?: boolean };

interface AssistantPanelState {
  open: boolean;
  text: string;
  subject: SubjectPart | null;
  /** A request to send once the conversation is loaded and free. */
  sendWhenReady: boolean;
  openAssistant: (request?: AssistantRequest) => void;
  setOpen: (open: boolean) => void;
  setText: (text: string) => void;
  setSubject: (subject: SubjectPart | null) => void;
  clearComposer: () => void;
  /** Hands the waiting send to the panel once. */
  takeSendWhenReady: () => boolean;
}

export const useAssistantStore = create<AssistantPanelState>((set, get) => ({
  open: false,
  text: "",
  subject: null,
  sendWhenReady: false,
  openAssistant: (request) =>
    set(
      request
        ? { open: true, text: request.text, subject: request.subject ?? null, sendWhenReady: Boolean(request.send) }
        : { open: true }
    ),
  setOpen: (open) => set({ open }),
  setText: (text) => set({ text }),
  setSubject: (subject) => set({ subject }),
  clearComposer: () => set({ text: "", subject: null, sendWhenReady: false }),
  takeSendWhenReady: () => {
    const waiting = get().sendWhenReady;
    if (waiting) set({ sendWhenReady: false });
    return waiting;
  },
}));
