"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { SearchSuggestion } from "@/lib/mapbox/search-box";
import type { ParsedPlaceData, GooglePlaceData } from "@/lib/types";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";

const SESSION_INACTIVITY_MS = 180_000; // 180s — Mapbox session expiry
const SUGGEST_DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

/**
 * `usePlaceSearch` — Mapbox Search Box client hook.
 *
 * Manages:
 *  - debounced search input → /api/search/suggest
 *  - session_token (UUIDv4) lifecycle: mint on first suggest of a session,
 *    rotate after successful retrieve OR 180s inactivity OR 50 suggest calls.
 *  - /api/search/retrieve/[id] mutation.
 *
 * Returns:
 *  - query, setQuery
 *  - suggestions (debounced)
 *  - isLoading
 *  - retrieve(mapboxId) → RetrievedPlaceData
 *  - clear()
 */
export function usePlaceSearch(opts?: {
  proximity?: { lng: number; lat: number };
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Session token lifecycle — mutable ref, not state (changes don't rerender consumers).
  const sessionTokenRef = useRef<string>(mintSessionToken());
  const lastActivityRef = useRef<number>(Date.now());
  const suggestCountRef = useRef<number>(0);

  const debouncedSetQuery = useDebouncedCallback((q: string) => {
    setDebouncedQuery(q);
  }, SUGGEST_DEBOUNCE_MS);

  // Track typing → debounce → debouncedQuery is what we send.
  useEffect(() => {
    debouncedSetQuery(query);
  }, [query, debouncedSetQuery]);

  // Rotate session on long inactivity.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > SESSION_INACTIVITY_MS) {
        sessionTokenRef.current = mintSessionToken();
        suggestCountRef.current = 0;
      }
    }, SESSION_INACTIVITY_MS);
    return () => clearInterval(id);
  }, []);

  const shouldQuery = debouncedQuery.trim().length >= MIN_QUERY_LEN;

  const suggestionsQuery = useQuery<SearchSuggestion[]>({
    queryKey: ["place-search", "suggest", debouncedQuery, opts?.proximity],
    enabled: shouldQuery,
    queryFn: async () => {
      // Activity bump + rotate session if call count hits 50.
      lastActivityRef.current = Date.now();
      if (suggestCountRef.current >= 50) {
        sessionTokenRef.current = mintSessionToken();
        suggestCountRef.current = 0;
      }
      suggestCountRef.current += 1;

      const params = new URLSearchParams({
        q: debouncedQuery,
        session_token: sessionTokenRef.current,
      });
      if (opts?.proximity) {
        params.set("proximity", `${opts.proximity.lng},${opts.proximity.lat}`);
      }

      const res = await fetch(`/api/search/suggest?${params.toString()}`);
      if (!res.ok) throw new Error("Suggest failed");
      const data = (await res.json()) as { suggestions: SearchSuggestion[] };
      return data.suggestions;
    },
    staleTime: 30_000,
  });

  const retrieveMutation = useMutation<RetrievedPlaceData, Error, string>({
    mutationFn: async (mapboxId: string) => {
      const params = new URLSearchParams({
        session_token: sessionTokenRef.current,
      });
      const res = await fetch(
        `/api/search/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`
      );
      if (!res.ok) throw new Error("Retrieve failed");
      return (await res.json()) as RetrievedPlaceData;
    },
    onSuccess: () => {
      // A suggest→retrieve pair closes the session — rotate.
      sessionTokenRef.current = mintSessionToken();
      suggestCountRef.current = 0;
      lastActivityRef.current = Date.now();
    },
  });

  const clear = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    retrieveMutation.reset();
  }, [retrieveMutation]);

  return {
    query,
    setQuery,
    suggestions: shouldQuery ? suggestionsQuery.data ?? [] : [],
    isSearching: shouldQuery && suggestionsQuery.isFetching,
    retrieve: retrieveMutation.mutateAsync,
    isRetrieving: retrieveMutation.isPending,
    retrieveError: retrieveMutation.error,
    clear,
  };
}

/** Server-shaped response from `/api/search/retrieve/[id]`. */
export interface RetrievedPlaceData extends ParsedPlaceData {
  _provider: "dataforseo" | "mapbox";
  _mapbox_id: string;
  _fetchTimeMs: number;
  _extended?: Partial<GooglePlaceData>;
  /** v1.22.1 — heuristic AI suggestions (subcategory + tags + lists),
   *  same shape parse-link returns; null when AI is disabled. */
  lite_profile?: PlaceProfile | null;
}

/**
 * UUIDv4 — crypto.randomUUID() in browser + secure contexts.
 * Falls back to Math.random for prehistoric envs (shouldn't matter for this app).
 */
function mintSessionToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
