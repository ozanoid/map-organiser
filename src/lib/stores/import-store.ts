import { create } from "zustand";
import type { VisitStatus } from "@/lib/types";

/**
 * File choice and import options — UI state only.
 *
 * Progress used to live here too, back when the browser drove the import loop.
 * It now belongs to the server (`import_jobs`) and is read through
 * `useImportJob`, per the rule that server state goes to React Query. That
 * split is what lets a user close the tab mid-import: nothing worth keeping is
 * held in this store.
 */
interface ImportState {
  phase: "idle" | "options";

  fileName: string | null;
  fileSize: number;

  visitStatus: VisitStatus | "";
  selectedListIds: string[];
  selectedTagIds: string[];

  setFile: (name: string, size: number) => void;
  clearFile: () => void;
  setVisitStatus: (status: VisitStatus | "") => void;
  toggleListId: (id: string) => void;
  toggleTagId: (id: string) => void;
  reset: () => void;
}

const initialState = {
  phase: "idle" as const,
  fileName: null,
  fileSize: 0,
  visitStatus: "" as VisitStatus | "",
  selectedListIds: [] as string[],
  selectedTagIds: [] as string[],
};

export const useImportStore = create<ImportState>((set) => ({
  ...initialState,

  setFile: (name, size) => set({ fileName: name, fileSize: size, phase: "options" }),

  clearFile: () => set({ ...initialState }),

  setVisitStatus: (status) => set({ visitStatus: status }),

  toggleListId: (id) =>
    set((s) => ({
      selectedListIds: s.selectedListIds.includes(id)
        ? s.selectedListIds.filter((x) => x !== id)
        : [...s.selectedListIds, id],
    })),

  toggleTagId: (id) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(id)
        ? s.selectedTagIds.filter((x) => x !== id)
        : [...s.selectedTagIds, id],
    })),

  reset: () => set({ ...initialState }),
}));
