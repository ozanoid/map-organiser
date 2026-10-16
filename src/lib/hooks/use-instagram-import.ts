"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { InstagramImportView } from "@/lib/instagram/types";

/**
 * Instagram import — start a job for a post URL, then poll its progress.
 *
 * The job lives on the server (import_jobs, kind "instagram"), so polling is a
 * read, not a driver: closing the dialog or refreshing the page loses nothing.
 */

export function useStartInstagramImport() {
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
  });
}

export function useInstagramImport(jobId: string | null) {
  return useQuery({
    queryKey: ["instagram-import", jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<InstagramImportView> => {
      const res = await fetch(`/api/instagram/import/${jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't load the Instagram import");
      return (await res.json()) as InstagramImportView;
    },
    // Poll while the server is still working; a finished job holds still.
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return !phase || phase === "reading" || phase === "adding" ? 1500 : false;
    },
  });
}
