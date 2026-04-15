import { create } from "zustand";
import type { VisitStatus } from "@/lib/types";

export interface ImportProgressItem {
  name: string;
  status: "enriched" | "imported" | "skipped";
  reason?: string;
}

export interface ImportResult {
  imported: number;
  failed: number;
  enriched: number;
  total: number;
  skipped: { name: string; reason: string }[];
  importedPlaceIds: string[];
}

interface ImportState {
  // Phase: idle → options → importing → done
  phase: "idle" | "options" | "importing" | "done";

  // File
  fileName: string | null;
  fileSize: number;

  // Options (pre-import)
  visitStatus: VisitStatus | "";
  selectedListIds: string[];
  selectedTagIds: string[];

  // Progress
  current: number;
  total: number;
  items: ImportProgressItem[];
  cancelled: boolean;

  // Result
  result: ImportResult | null;
  reviewsEnriching: boolean;

  // Actions
  setFile: (name: string, size: number) => void;
  clearFile: () => void;
  setVisitStatus: (status: VisitStatus | "") => void;
  toggleListId: (id: string) => void;
  toggleTagId: (id: string) => void;
  startImport: (total: number) => void;
  updateProgress: (current: number, items: ImportProgressItem[]) => void;
  requestCancel: () => void;
  finishImport: (result: ImportResult) => void;
  setReviewsEnriching: (v: boolean) => void;
  reset: () => void;
}

const initialState = {
  phase: "idle" as const,
  fileName: null,
  fileSize: 0,
  visitStatus: "" as VisitStatus | "",
  selectedListIds: [] as string[],
  selectedTagIds: [] as string[],
  current: 0,
  total: 0,
  items: [] as ImportProgressItem[],
  cancelled: false,
  result: null,
  reviewsEnriching: false,
};

export const useImportStore = create<ImportState>((set) => ({
  ...initialState,

  setFile: (name, size) => set({ fileName: name, fileSize: size, phase: "options", result: null }),

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

  startImport: (total) => set({ phase: "importing", current: 0, total, items: [], cancelled: false, result: null }),

  updateProgress: (current, items) => set({ current, items }),

  requestCancel: () => set({ cancelled: true }),

  finishImport: (result) => set({ phase: "done", result, current: result.total }),

  setReviewsEnriching: (v) => set({ reviewsEnriching: v }),

  reset: () => set({ ...initialState }),
}));
