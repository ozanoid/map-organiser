"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLists } from "@/lib/hooks/use-lists";
import { useTags } from "@/lib/hooks/use-tags";
import {
  useImportJob,
  useCreateImportJob,
  useCancelImportJob,
} from "@/lib/hooks/use-import-job";
import { useImportStore } from "@/lib/stores/import-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackfillProfilesPanel } from "@/components/settings/backfill-profiles-panel";
import {
  Upload, FileJson, Check, Loader2, AlertCircle,
  X as XIcon, Bookmark, CalendarCheck, CheckCircle, Heart, StopCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { VisitStatus } from "@/lib/types";

const VISIT_STATUS_OPTIONS: { value: VisitStatus | ""; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "", label: "None", icon: XIcon },
  { value: "want_to_go", label: "Want to Go", icon: Bookmark },
  { value: "booked", label: "Booked", icon: CalendarCheck },
  { value: "visited", label: "Visited", icon: CheckCircle },
  { value: "favorite", label: "Favorite", icon: Heart },
];

export default function ImportPage() {
  const store = useImportStore();
  const { data: lists = [] } = useLists();
  const { data: tags = [] } = useTags();
  const queryClient = useQueryClient();
  const fileRef = useRef<File | null>(null);

  const { data: job } = useImportJob();
  const createJob = useCreateImportJob();
  const cancelJob = useCancelImportJob();

  const running = job?.status === "running";

  // Places land on the map as the drain works through them, so refresh the
  // lists while a job is live rather than only at the end.
  useEffect(() => {
    if (!running) return;
    queryClient.invalidateQueries({ queryKey: ["places"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [running, job?.settled, queryClient]);

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".json") && !f.name.endsWith(".geojson") && !f.name.endsWith(".csv")) {
      toast.error("Please upload a .json, .geojson, or .csv file");
      return;
    }
    fileRef.current = f;
    store.setFile(f.name, f.size);
  }, [store]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }

  async function handleImport() {
    const file = fileRef.current;
    if (!file) return;

    try {
      const { total } = await createJob.mutateAsync({
        file,
        visitStatus: store.visitStatus || null,
        listIds: store.selectedListIds,
        tagIds: store.selectedTagIds,
      });
      fileRef.current = null;
      store.reset();
      toast.success(`${total} places queued — this runs on the server, you can close the page.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start import");
    }
  }

  const pct = job && job.total > 0 ? Math.round((job.settled / job.total) * 100) : 0;
  const imported = (job?.counts.done ?? 0) + (job?.counts.reviews ?? 0) + (job?.counts.profile ?? 0);
  const showDropzone = store.phase === "idle" && !running;

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import Places</h1>
        <p className="text-sm text-muted-foreground mt-1">Import your saved places from Google Takeout</p>
      </div>

      {/* Instructions */}
      <Card className="p-4 text-sm space-y-2">
        <h3 className="font-medium">How to export from Google:</h3>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
          <li>Go to takeout.google.com</li>
          <li>Deselect all, then select only &quot;Saved&quot; (Maps)</li>
          <li>Export as GeoJSON or CSV</li>
          <li>Download and upload the file below</li>
        </ol>
      </Card>

      {/* Upload area */}
      {showDropzone && (
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center transition-colors border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <label className="cursor-pointer block">
            <Upload className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Drag &amp; drop your file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <input type="file" className="hidden" accept=".json,.geojson,.csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* Options phase */}
      {store.phase === "options" && !running && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <FileJson className="h-8 w-8 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{store.fileName}</p>
              <p className="text-xs text-muted-foreground">{(store.fileSize / 1024).toFixed(1)} KB</p>
            </div>
          </div>

          <h3 className="text-sm font-semibold pt-1">Import Options</h3>

          {/* Visit Status */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Visit Status</label>
            <div className="flex flex-wrap gap-1.5">
              {VISIT_STATUS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = store.visitStatus === opt.value;
                return (
                  <button key={opt.value} type="button" onClick={() => store.setVisitStatus(opt.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors flex items-center gap-1 ${
                      active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                             : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}>
                    <Icon className="h-3 w-3" />{opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lists */}
          {lists.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Add to Lists</label>
              <div className="flex flex-wrap gap-1.5">
                {lists.map((list) => {
                  const active = store.selectedListIds.includes(list.id);
                  return (
                    <button key={list.id} type="button" onClick={() => store.toggleListId(list.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                        active ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      }`}
                      style={active ? { backgroundColor: list.color } : undefined}>
                      {list.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Add Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = store.selectedTagIds.includes(tag.id);
                  return (
                    <button key={tag.id} type="button" onClick={() => store.toggleTagId(tag.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                        active ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      }`}>
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { fileRef.current = null; store.clearFile(); }} className="cursor-pointer">
              Change file
            </Button>
            <Button size="sm" onClick={handleImport} disabled={createJob.isPending} className="cursor-pointer">
              {createJob.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Queueing...</>
                : <><Upload className="h-4 w-4 mr-1" />Start Import</>}
            </Button>
          </div>
        </Card>
      )}

      {/* Running job. Survives a page close — the drain owns the work, this
          card only reports on it. */}
      {job && running && (
        <Card className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Importing… {job.settled} / {job.total}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{pct}%</span>
                <Button variant="ghost" size="sm" onClick={() => cancelJob.mutate(job.id)}
                  disabled={cancelJob.isPending}
                  className="cursor-pointer text-red-500 hover:text-red-600 h-7 px-2">
                  <StopCircle className="h-3.5 w-3.5 mr-1" />Cancel
                </Button>
              </div>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>

            {/* Each label is ONE expression. Splitting it as `{count} text`
                leaves the space between them at the mercy of JSX text-node
                trimming, which ate it here and rendered "5on the map". */}
            <div className="space-y-1 text-xs">
              {job.pending_import > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>{`${job.pending_import} waiting to be added`}</span>
                </div>
              )}
              {job.enriching > 0 && (
                <div className="flex items-center gap-2 text-emerald-600">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>{`${job.enriching} on the map, collecting reviews & tags`}</span>
                </div>
              )}
              {imported > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                  <span>{`${imported} added`}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground border-t pt-3">
              This runs on the server. You can close this page — it keeps going.
            </p>
          </div>
        </Card>
      )}

      {/* Finished job */}
      {job && !running && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            {job.problems.length === 0
              ? <Check className="h-8 w-8 text-emerald-600" />
              : <AlertCircle className="h-8 w-8 text-orange-500" />}
            <div>
              <p className="font-medium text-sm">
                {job.status === "cancelled" ? "Import cancelled" : "Import complete"}
              </p>
              <p className="text-xs text-muted-foreground">
                {job.counts.done ?? 0} added
                {job.problems.length > 0 ? `, ${job.problems.length} skipped` : ""} out of {job.total}
              </p>
            </div>
          </div>

          {job.problems.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Skipped places:</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {job.problems.map((s, i) => (
                  <div key={i} className="text-xs bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-2">({s.reason})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 pt-3 border-t">
            <Button variant="outline" size="sm" className="cursor-pointer"
              onClick={() => { fileRef.current = null; store.reset(); }}>
              Import another file
            </Button>
          </div>
        </Card>
      )}

      {/* Profile backfill for places imported before the pipeline existed —
          self-hides when there's nothing eligible. */}
      {!running && <BackfillProfilesPanel />}
    </div>
  );
}
