import { create } from "zustand";

/**
 * The assistant panel's open state, app-wide: the header button opens it,
 * and other screens can open it with a request already written (AI Plan,
 * Compare, the search bar — Phase 2, decision 6.1). The request is put in
 * the composer, not sent: the user reads it and sends it.
 */
interface AssistantPanelState {
  open: boolean;
  /** Text waiting to be put in the composer when the panel opens. */
  draft: string | null;
  openAssistant: (draft?: string) => void;
  setOpen: (open: boolean) => void;
  /** Hands the waiting text to the composer once. */
  takeDraft: () => string | null;
}

export const useAssistantStore = create<AssistantPanelState>((set, get) => ({
  open: false,
  draft: null,
  openAssistant: (draft) => set({ open: true, draft: draft ?? null }),
  setOpen: (open) => set({ open }),
  takeDraft: () => {
    const draft = get().draft;
    if (draft !== null) set({ draft: null });
    return draft;
  },
}));
