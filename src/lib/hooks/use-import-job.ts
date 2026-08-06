"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Progress of the newest import job.
 *
 * The job runs entirely server-side (see `/api/cron/drain-imports`), so this is
 * a read, not a driver — closing the tab does not pause anything, and reopening
 * the page picks the run back up because the server, not the store, holds it.
 */
export interface ImportJobProgress {
  id: string;
  file_name: string | null;
  total: number;
  status: "running" | "done" | "cancelled";
  created_at: string;
  finished_at: string | null;
  /** Row count per stage: import | photo | reviews | profile | done | skipped | failed. */
  counts: Record<string, number>;
  /** Reached a terminal stage, whatever the outcome. */
  settled: number;
  /** Not yet on the map. */
  pending_import: number;
  /** On the map, still collecting reviews or a profile. */
  enriching: number;
  problems: { name: string; reason: string }[];
}

const KEY = ["import-job"] as const;

export function useImportJob(enabled = true) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async (): Promise<ImportJobProgress | null> => {
      const res = await fetch("/api/places/import-jobs");
      if (!res.ok) throw new Error("Failed to load import job");
      const data = await res.json();
      return data.job ?? null;
    },
    // Poll only while there is something to watch. A finished job holds still,
    // so there is nothing to gain from asking again.
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });
}

export function useCreateImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      file: File;
      visitStatus: string | null;
      listIds: string[];
      tagIds: string[];
    }): Promise<{ jobId: string; total: number }> => {
      const formData = new FormData();
      formData.append("file", input.file);
      formData.append(
        "options",
        JSON.stringify({
          visit_status: input.visitStatus || null,
          list_ids: input.listIds,
          tag_ids: input.tagIds,
        })
      );

      const res = await fetch("/api/places/import-jobs", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start import");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelImportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/places/import-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!res.ok) throw new Error("Failed to cancel import");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
