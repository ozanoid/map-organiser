import { create } from "zustand";
import type { SubjectArea } from "@/lib/agent/ui-types";

/**
 * The part of the map on screen, while the map is: written by the map as it
 * moves, cleared when it goes. A request to the assistant from the search
 * field carries it as the subject's area ("here"), so the answer is about
 * what the user is looking at (Phase 2, decision 6.1).
 */
interface MapAreaState {
  area: SubjectArea | null;
  setArea: (area: SubjectArea | null) => void;
}

export const useMapAreaStore = create<MapAreaState>((set) => ({
  area: null,
  setArea: (area) => set({ area }),
}));
