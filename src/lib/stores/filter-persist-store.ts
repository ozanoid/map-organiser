"use client";

import { create } from "zustand";

/**
 * Session-level cache of the last URL query string seen on /map or /places.
 *
 * Background: filters live in the URL (`?city=London&category=...`),
 * read by `useFilters`. The AppSidebar and MobileNav links to /map and
 * /places preserve the current URL's query string — but only when the
 * user is ALREADY on /map or /places. When the user is on /lists,
 * /stats, /import, /settings, /places/[id] (etc.), the current URL has
 * no filter params, so a sidebar click would land on /map (no params)
 * and wipe the user's session state.
 *
 * This store remembers the last /map or /places query string so the
 * sidebar/mobile-nav can restore it when the user returns from a
 * non-filter-context page. Pure mirror of the URL — no separate truth.
 *
 * Cleared via the mirror effect when FilterPanel's "Clear" button (or
 * AISearchInput's "X") strips the URL to bare path.
 *
 * v1.8.8 fix: previously a round-trip /map → /lists → /map dropped the
 * filters but kept the AI store (zustand singleton), producing a
 * confusing "AI active mode + all places + no filter chips" state.
 */
interface FilterPersistState {
  /** Last query string captured on /map or /places. Empty when no
   *  filters are active. */
  lastMapPlacesQuery: string;
  setLastMapPlacesQuery: (qs: string) => void;
}

export const useFilterPersistStore = create<FilterPersistState>((set) => ({
  lastMapPlacesQuery: "",
  setLastMapPlacesQuery: (qs) => set({ lastMapPlacesQuery: qs }),
}));

// ─── Debug: expose to window for console inspection ───
// Same gating as ai-search-store: dev OR localStorage["ai-debug"]="1".
if (typeof window !== "undefined") {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    (() => {
      try {
        return window.localStorage?.getItem("ai-debug") === "1";
      } catch {
        return false;
      }
    })();
  if (enabled) {
    (window as unknown as {
      __filterPersistStore: typeof useFilterPersistStore;
    }).__filterPersistStore = useFilterPersistStore;
  }
}
