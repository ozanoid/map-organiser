"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstagramImportView } from "@/lib/instagram/types";

/**
 * Instagram import — start a job for a post URL, then poll its progress.
 *
 * The job lives on the server (import_jobs, kind "instagram"), so polling is a
 * read, not a driver: closing the dialog or refreshing the page loses nothing.
 */

/** `onStarted` sits on the mutation, not on `mutate()`: TanStack drops
 *  mutate's callbacks once the dialog unmounts, and a job started just before
 *  "Continue in background" still has to reach the page that watches it. */
export function useStartInstagramImport(onStarted?: (jobId: string) => void) {
  return useMutation({
    mutationFn: async (url: string): Promise<{ jobId: string; reused?: boolean }> => {
      const res = await fetch("/api/instagram/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as { jobId?: string; reused?: boolean; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error ?? "Couldn't start the Instagram import");
      return { jobId: data.jobId, reused: data.reused };
    },
    onSuccess: (data) => onStarted?.(data.jobId),
  });
}

export function useInstagramImport(jobId: string | null, opts?: { waitForPhotos?: boolean }) {
  const waitForPhotos = opts?.waitForPhotos ?? true;
  return useQuery({
    queryKey: ["instagram-import", jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<InstagramImportView> => {
      const res = await fetch(`/api/instagram/import/${jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't load the Instagram import");
      return (await res.json()) as InstagramImportView;
    },
    // Poll while the server is still working, then a little slower while the
    // new places' photos come in (the server stops calling a photo pending
    // after a while); a finished job holds still.
    refetchInterval: (query) => {
      const view = query.state.data;
      if (!view || view.phase === "reading" || view.phase === "adding") return 1500;
      return waitForPhotos && view.items.some((i) => i.photoPending) ? 3000 : false;
    },
  });
}

/** Add the place the user picked for a skipped venue (a chain's branch). */
export function usePickInstagramPlace(jobId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { itemId: string; placeId: string }) => {
      const res = await fetch(`/api/instagram/import/${jobId}/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't add that place");
      return { status: data.status === "already_saved" ? "already_saved" : "pending" } as const;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instagram-import", jobId] }),
  });
}
