"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLists } from "@/lib/hooks/use-lists";
import { useTags } from "@/lib/hooks/use-tags";
import { useImportStore } from "@/lib/stores/import-store";
import type { ImportProgressItem, ImportResult } from "@/lib/stores/import-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Upload, FileJson, Check, Loader2, AlertCircle, CheckCircle2,
  X as XIcon, Bookmark, CalendarCheck, CheckCircle, Heart, StopCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { VisitStatus } from "@/lib/types";

const BATCH_SIZE = 3;

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

    // Step 1: Parse
    const formData = new FormData();
    formData.append("file", file);

    let places: any[];
    try {
      const res = await fetch("/api/places/import-parse", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to parse file");
        return;
      }
      const parsed = await res.json();
      places = parsed.places;
    } catch {
      toast.error("Failed to parse file");
      return;
    }

    // Step 2: Batch loop
    store.startImport(places.length);

    let imported = 0;
    let failed = 0;
    let enriched = 0;
    const skipped: { name: string; reason: string }[] = [];
    const importedPlaceIds: string[] = [];
    const allItems: ImportProgressItem[] = [];

    for (let i = 0; i < places.length; i += BATCH_SIZE) {
      // Check cancel — read directly from store
      if (useImportStore.getState().cancelled) {
        toast.info(`Import cancelled. ${imported} places imported so far.`);
        break;
      }

      const batch = places.slice(i, i + BATCH_SIZE);

      try {
        const res = await fetch("/api/places/import-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            places: batch,
            visit_status: store.visitStatus || null,
            list_ids: store.selectedListIds,
            tag_ids: store.selectedTagIds,
          }),
        });

        if (!res.ok) {
          for (const p of batch) {
            failed++;
            skipped.push({ name: p.name, reason: "Request failed" });
            allItems.push({ name: p.name, status: "skipped", reason: "Request failed" });
          }
        } else {
          const data = await res.json();
          for (const r of data.results) {
            if (r.status === "skipped") {
              failed++;
              skipped.push({ name: r.name, reason: r.reason || "Skipped" });
            } else {
              imported++;
              if (r.status === "enriched") enriched++;
              if (r.placeId) importedPlaceIds.push(r.placeId);
            }
            allItems.push(r);
          }
        }
      } catch {
        for (const p of batch) {
          failed++;
          skipped.push({ name: p.name, reason: "Network error" });
          allItems.push({ name: p.name, status: "skipped", reason: "Network error" });
        }
      }

      // Update store — Zustand triggers re-render
      store.updateProgress(
        Math.min(i + BATCH_SIZE, places.length),
        allItems.slice(-4)
      );
    }

    // Done
    const result: ImportResult = { imported, failed, enriched, total: places.length, skipped, importedPlaceIds };
    store.finishImport(result);
    queryClient.invalidateQueries({ queryKey: ["places"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });

    if (imported > 0) toast.success(`Imported ${imported} places!`);

    // Background reviews
    if (importedPlaceIds.length > 0) {
      store.setReviewsEnriching(true);
      try {
        for (let j = 0; j < importedPlaceIds.length; j += 5) {
          await fetch("/api/places/bulk-enrich-reviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ placeIds: importedPlaceIds.slice(j, j + 5) }),
          });
        }
        queryClient.invalidateQueries({ queryKey: ["places"] });
      } catch {}
      store.setReviewsEnriching(false);
    }
  }

  const pct = store.total > 0 ? Math.round((store.current / store.total) * 100) : 0;

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

      {/* Upload area — only in idle phase */}
      {store.phase === "idle" && (
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center transition-colors border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <label className="cursor-pointer block">
            <Upload className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Drag & drop your file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <input type="file" className="hidden" accept=".json,.geojson,.csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* Options phase */}
      {store.phase === "options" && (
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
            <Button size="sm" onClick={handleImport} className="cursor-pointer">
              <Upload className="h-4 w-4 mr-1" />Start Import
            </Button>
          </div>
        </Card>
      )}

      {/* Importing phase */}
      {store.phase === "importing" && (
        <Card className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Importing... {store.current} / {store.total}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{pct}%</span>
                <Button variant="ghost" size="sm" onClick={() => store.requestCancel()}
                  className="cursor-pointer text-red-500 hover:text-red-600 h-7 px-2">
                  <StopCircle className="h-3.5 w-3.5 mr-1" />Cancel
                </Button>
              </div>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="space-y-1">
              {store.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {item.status === "enriched" ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" /> :
                   item.status === "imported" ? <Check className="h-3 w-3 text-blue-500 shrink-0" /> :
                   <XIcon className="h-3 w-3 text-red-400 shrink-0" />}
                  <span className="truncate">{item.name}</span>
                  {item.reason && <span className="text-muted-foreground shrink-0">— {item.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Done phase */}
      {store.phase === "done" && store.result && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            {store.result.failed === 0 ? <Check className="h-8 w-8 text-emerald-600" /> : <AlertCircle className="h-8 w-8 text-orange-500" />}
            <div>
              <p className="font-medium text-sm">Import complete</p>
              <p className="text-xs text-muted-foreground">
                {store.result.imported} imported, {store.result.enriched} enriched
                {store.result.failed > 0 ? `, ${store.result.failed} skipped` : ""} out of {store.result.total}
              </p>
            </div>
          </div>

          {store.reviewsEnriching && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600">
              <Loader2 className="h-3 w-3 animate-spin" />Enriching reviews in background...
            </div>
          )}

          {store.result.skipped.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Skipped places:</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {store.result.skipped.map((s, i) => (
                  <div key={i} className="text-xs bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-2">({s.reason})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 pt-3 border-t">
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => { fileRef.current = null; store.reset(); }}>
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
